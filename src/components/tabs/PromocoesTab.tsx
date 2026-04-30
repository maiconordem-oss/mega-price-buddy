import { useState, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ml, proxyPost, serverSave, serverLoad, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useShopReset } from "@/hooks/useShopReset";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Search, Tag, Check, X,
  ChevronDown, ChevronRight, ExternalLink, AlertTriangle,
} from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Promo {
  promotionId:    string;
  promotionType:  string;
  name:           string;           // nome da campanha
  status:         string;           // active | candidate | pending | finished
  isInvite:       boolean;
  startDate?:     string;
  endDate?:       string;
  deadlineDate?:  string;
  discountPct?:   number;           // % desconto total
  sellerPct?:     number;           // % subsidiado pelo vendedor
  meliPct?:       number;           // % subsidiado pelo ML
  currentPrice?:  number;
  finalPrice?:    number;           // preço final com desconto
  minPrice?:      number;
  maxPrice?:      number;
  suggestedPrice?: number;
  youReceive?:    number;           // o que você recebe (após taxas ML)
  meliDiscount?:  number;          // desconto nas tarifas do ML
}

interface ProductGroup {
  mlItemId:     string;
  name:         string;
  image:        string;
  sku:          string;
  currentPrice: number;
  stock:        number;
  listingType:  string;
  promos:       Promo[];
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CACHE_KEY = "promocoes-v2";
const CACHE_TTL = 60; // 1h

const IGNORE_TYPES = ["SMART", "PRICE_MATCHING"];

const TYPE_LABEL: Record<string, string> = {
  DEAL:                   "Deal do Dia",
  DOD:                    "Oferta do Dia",
  SELLER_CAMPAIGN:        "Campanha Vendedor",
  MARKETPLACE_CAMPAIGN:   "Impulsione suas vendas",
  LIGHTNING:              "Relâmpago",
  PRICE_DISCOUNT:         "Desconto por porcentagem",
  VOLUME:                 "Volume",
  UNHEALTHY_STOCK:        "Liquidação Full",
  PRE_NEGOTIATED:         "Pré-Negociado",
  SELLER_COUPON_CAMPAIGN: "Cupom para carrinhos",
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active:    { label: "ATIVA",     cls: "bg-green-500/15 text-green-700 border-0" },
  started:   { label: "ATIVA",     cls: "bg-green-500/15 text-green-700 border-0" },
  candidate: { label: "CONVITE",   cls: "bg-yellow-400/20 text-yellow-700 border-0" },
  invited:   { label: "CONVITE",   cls: "bg-yellow-400/20 text-yellow-700 border-0" },
  pending:   { label: "PENDENTE",  cls: "bg-blue-500/15 text-blue-700 border-0" },
  paused:    { label: "PAUSADA",   cls: "bg-muted text-muted-foreground border-0" },
  finished:  { label: "ENCERRADA", cls: "bg-muted text-muted-foreground border-0" },
};

const LISTING_LABEL: Record<string, string> = {
  gold_pro:     "Premium",
  gold_special: "Clássico",
  gold:         "Ouro",
  silver:       "Prata",
  free:         "Grátis",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function getStatusStr(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw.toLowerCase();
  const obj = raw as Record<string, unknown>;
  return String(obj.id || obj.status || "").toLowerCase();
}

function extractPromos(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  for (const key of ["results", "promotions", "data", "elements"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if ((obj as Record<string, unknown>).promotion_type) return [obj];
  return [];
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PromocoesTab() {
  const { products } = useProducts();
  const { userId, mlConnected } = useAuth();

  const [groups,      setGroups]      = useState<ProductGroup[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [search,      setSearch]      = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "invite">("all");
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [actingKey,   setActingKey]   = useState<string | null>(null);
  const [confirm,     setConfirm]     = useState<{
    group: ProductGroup;
    promo: Promo;
    discountPct: number;   // percentual editável pelo usuário
    finalPrice:  number;
    youReceive:  number;
  } | null>(null);

  useShopReset(useCallback(() => {
    setGroups([]); setLoaded(false); setExpanded(new Set());
  }, []));

  // ── Expandir/colapsar produto ─────────────────────────────────────────────
  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  // ── Load: busca todas as promoções do seller de uma vez ──────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) { toast.info("Conecte o Mercado Livre."); return; }

    const mlItems = products.filter(p => p.mlItemId);
    if (!mlItems.length) { toast.info("Carregue os produtos na aba Precificação primeiro."); return; }

    if (!force && loaded) return;

    // Cache
    if (!force) {
      try {
        const cached = await serverLoad<ProductGroup[]>(CACHE_KEY);
        if (cached?.data && cached?.ts) {
          const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
          if (age < CACHE_TTL) { setGroups(cached.data); setLoaded(true); return; }
        }
      } catch {}
    }

    setLoading(true);
    setLoadingStep("Buscando todas as promoções do seller...");

    try {
      // ── Estratégia 1: endpoint de lista do seller (1 chamada só) ─────────
      let promoByItem: Record<string, Promo[]> = {};
      let usedBulk = false;

      try {
        const bulkRes = await ml(
          `/seller-promotions/search?seller_id=${userId}&app_version=v2&status=active,started,candidate,invited,pending,paused&limit=100`
        ) as unknown;
        const items = extractPromos(bulkRes);
        if (items.length > 0) {
          usedBulk = true;
          for (const raw of items) {
            const o = raw as Record<string, unknown>;
            const type      = String(o.promotion_type || "");
            const statusStr = getStatusStr(o.status);
            if (IGNORE_TYPES.includes(type)) continue;

            const itemIds: string[] = [];
            // A resposta pode ter item_ids, items, ou item_id
            const rawIds = o.item_ids || o.items || (o.item_id ? [o.item_id] : []);
            if (Array.isArray(rawIds)) {
              rawIds.forEach((id: unknown) => {
                const sid = String(id);
                itemIds.push(sid.startsWith("MLB") ? sid : `MLB${sid}`);
              });
            }

            const promo: Promo = {
              promotionId:    String(o.id || o.promotion_id || ""),
              promotionType:  type,
              name:           String(o.name || TYPE_LABEL[type] || type),
              status:         statusStr,
              isInvite:       ["candidate","invited","pending"].includes(statusStr),
              startDate:      o.start_date as string | undefined,
              endDate:        (o.finish_date || o.end_date) as string | undefined,
              deadlineDate:   o.deadline_date as string | undefined,
              discountPct:    (o.discount_percentage || o.discount?.percentage) as number | undefined,
              sellerPct:      o.seller_percentage as number | undefined,
              meliPct:        o.meli_percentage as number | undefined,
              minPrice:       o.min_discounted_price as number | undefined,
              maxPrice:       o.max_discounted_price as number | undefined,
              suggestedPrice: o.suggested_discounted_price as number | undefined,
            };

            for (const id of itemIds) {
              if (!promoByItem[id]) promoByItem[id] = [];
              promoByItem[id].push(promo);
            }
          }
        }
      } catch { usedBulk = false; }

      // ── Estratégia 2: por item (fallback se bulk não funcionar) ──────────
      if (!usedBulk || Object.keys(promoByItem).length === 0) {
        promoByItem = {};
        const total      = mlItems.length;
        const BATCH_SIZE = 10;  // 10 itens por lote
        const batches: typeof mlItems[] = [];
        for (let i = 0; i < total; i += BATCH_SIZE) {
          batches.push(mlItems.slice(i, i + BATCH_SIZE));
        }

        setLoadingStep(`Buscando promoções de ${total} produtos em ${batches.length} lotes paralelos...`);

        // Todos os lotes em paralelo — sem esperar um terminar para começar o próximo
        await Promise.all(batches.map(async (batch, batchIdx) => {
          // Pequeno jitter para não bater todos exatamente ao mesmo tempo
          await new Promise(r => setTimeout(r, batchIdx * 50));

          await Promise.all(batch.map(async p => {
            try {
              const raw   = await ml(`/seller-promotions/items/${p.mlItemId}?app_version=v2`);

              // Log dos primeiros itens para diagnóstico
              if (Object.keys(promoByItem).length < 3) {
                console.log(`[PROMO] ${p.mlItemId}:`, JSON.stringify(raw, null, 2));
              }

              const items = extractPromos(raw);
              const id    = p.mlItemId!;
              const price = p.listings.find(l => l.channel === "ml")?.currentPrice || 0;

              const promos: Promo[] = [];
              for (const item of items) {
                const o = item as Record<string, unknown>;

                // ── Tipo e status ──────────────────────────────────────────
                const type      = String(o.promotion_type || o.type || "");
                if (!type || IGNORE_TYPES.includes(type)) continue;

                const statusStr = getStatusStr(o.status);
                const isInvite  = ["candidate","invited","pending"].includes(statusStr);
                const isActive  = ["started","active"].includes(statusStr);
                if (!isInvite && !isActive && statusStr !== "paused") continue;

                const deadline = (o.deadline_date || o.offer_deadline) as string | undefined;
                const start    = (o.start_date || o.date_from)    as string | undefined;
                const finish   = (o.finish_date || o.end_date || o.date_to) as string | undefined;

                if (isInvite) {
                  if (deadline && new Date(deadline) < new Date()) continue;
                  if (finish   && new Date(finish)   < new Date()) continue;
                  if ((type === "PRICE_DISCOUNT" || type === "LIGHTNING") && !deadline) continue;
                }

                // ── ID da promoção ─────────────────────────────────────────
                // A API pode retornar id como número, string, ou dentro de sub-objetos
                const promoId = String(
                  o.id || o.promotion_id || o.deal_id || o.campaign_id || ""
                );

                // ── Nome ───────────────────────────────────────────────────
                // 'name' pode ser número 0 (campo ausente), string, ou em sub-campo
                const rawName = o.name || o.campaign_name || o.deal_name || o.title;
                const name = rawName && typeof rawName === "string" && rawName !== "0"
                  ? rawName
                  : TYPE_LABEL[type] || type;

                // ── Desconto ───────────────────────────────────────────────
                // A API v2 pode ter estrutura aninhada: { discount: { percentage, type } }
                const discObj = o.discount as Record<string, unknown> | undefined;
                let discountPct = (
                  o.discount_percentage
                  || discObj?.percentage
                  || discObj?.value
                  || o.percentage
                  || o.offer_percentage
                ) as number | undefined;

                // sellerPct: pode estar em seller_percentage ou offer.seller_percentage
                const offerObj = o.offer as Record<string, unknown> | undefined;
                let sellerPct = (
                  o.seller_percentage
                  || offerObj?.seller_percentage
                  || o.seller_discount_percentage
                ) as number | undefined;

                let meliPct = (
                  o.meli_percentage
                  || offerObj?.meli_percentage
                  || o.meli_discount_percentage
                ) as number | undefined;

                // ── Preços ─────────────────────────────────────────────────
                const priceObj = o.price as Record<string, unknown> | undefined;
                let minPrice = (
                  o.min_discounted_price
                  || o.minimum_price
                  || priceObj?.min
                ) as number | undefined;

                let maxPrice = (
                  o.max_discounted_price
                  || o.maximum_price
                  || priceObj?.max
                ) as number | undefined;

                let suggestedPrice = (
                  o.suggested_discounted_price
                  || o.suggested_price
                  || o.deal_price
                  || priceObj?.suggested
                ) as number | undefined;

                // ── Normaliza decimais vs inteiros ─────────────────────────
                // sellerPct e meliPct: se > 1, é percentual inteiro (ex: 13 = 13%)
                // se < 1, é decimal (ex: 0.13 = 13%)
                if (sellerPct !== undefined && sellerPct > 1) sellerPct = sellerPct / 100;
                if (meliPct   !== undefined && meliPct   > 1) meliPct   = meliPct   / 100;
                if (discountPct !== undefined && discountPct > 1) discountPct = discountPct / 100;

                // ── Calcula preço final se não veio da API ─────────────────
                const totalDisc = (sellerPct || 0) + (meliPct || 0) || discountPct || 0;
                if (!suggestedPrice && totalDisc > 0 && price > 0) {
                  suggestedPrice = Math.round(price * (1 - totalDisc) * 100) / 100;
                }

                promos.push({
                  promotionId:    promoId,
                  promotionType:  type,
                  name,
                  status:         statusStr,
                  isInvite,
                  startDate:      start,
                  endDate:        finish,
                  deadlineDate:   deadline,
                  discountPct:    discountPct || totalDisc || undefined,
                  sellerPct,
                  meliPct,
                  minPrice,
                  maxPrice,
                  suggestedPrice,
                  currentPrice:   price,
                });
              }

              if (promos.length > 0) {
                promoByItem[id] = (promoByItem[id] || []).concat(promos);
              }

              const done = Object.keys(promoByItem).length;
              setLoadingStep(`${done} / ${total} produtos processados...`);

            } catch (e) {
              const msg = (e as Error).message;
              if (!msg.includes("404") && !msg.includes("not_found")) {
                console.warn(`Promoções ${p.mlItemId}:`, msg);
              }
            }
          }));
        }));
      }

      // ── Monta grupos por produto ──────────────────────────────────────────
      setLoadingStep("Consolidando...");
      const result: ProductGroup[] = mlItems
        .filter(p => (promoByItem[p.mlItemId!] || []).length > 0)
        .map(p => {
          const listing    = p.listings.find(l => l.channel === "ml");
          const price      = listing?.currentPrice || 0;
          const commission = (listing?.fee || 12) / 100;

          const promos = (promoByItem[p.mlItemId!] || []).map(promo => {
            // discountPct pode vir como decimal ou inteiro dependendo do endpoint
            const sellerDec = promo.sellerPct || 0   // ex: 0.10
            const meliDec   = promo.meliPct   || 0   // ex: 0.05
            const totalDec  = sellerDec + meliDec     // ex: 0.15 = 15%

            // discountPct: normaliza para decimal
            let discDec = promo.discountPct || 0
            if (discDec > 1) discDec = discDec / 100  // veio como inteiro (ex: 10 → 0.10)

            // Usa o maior desconto disponível para calcular preço final
            const bestDec = discDec || totalDec

            // Preço final: preferência para suggestedPrice da API, depois calcula
            const finalP = promo.suggestedPrice
              || promo.minPrice  // min = maior desconto possível
              || (bestDec > 0 ? Math.round(price * (1 - bestDec) * 100) / 100 : undefined)

            // O que você recebe = preço final menos comissão ML
            const youGet = finalP ? Math.round(finalP * (1 - commission) * 100) / 100 : undefined

            // Quanto o ML reduz das tarifas (subsidio)
            const meliDisc = meliDec > 0 && finalP
              ? Math.round(finalP * commission * meliDec * 100) / 100
              : undefined

            // discountPct final em decimal para exibição
            const displayDiscDec = bestDec || (finalP && price > 0 ? 1 - finalP / price : 0)

            // Filtra promoções com desconto absurdo (>50% = dado inválido da API)
            const MAX_DISCOUNT = 0.50
            if (displayDiscDec && displayDiscDec > MAX_DISCOUNT) return null

            return {
              ...promo,
              currentPrice:  price,
              finalPrice:    finalP,
              youReceive:    youGet,
              meliDiscount:  meliDisc,
              discountPct:   displayDiscDec,  // sempre decimal agora
              sellerPct:     sellerDec,
              meliPct:       meliDec,
            }
          }).filter((p): p is NonNullable<typeof p> => p !== null);
          return {
            mlItemId:     p.mlItemId!,
            name:         p.name,
            image:        p.image,
            sku:          p.sku,
            currentPrice: price,
            stock:        (p as Record<string, unknown>).available_quantity as number || 0,
            listingType:  p.listing_type_id || "gold_special",
            promos,
          };
        })
        .sort((a, b) => {
          // Produtos com convites primeiro
          const aHasInvite = a.promos.some(p => p.isInvite) ? 1 : 0;
          const bHasInvite = b.promos.some(p => p.isInvite) ? 1 : 0;
          return bHasInvite - aHasInvite;
        });

      // Expande todos por padrão
      setExpanded(new Set(result.map(g => g.mlItemId)));
      setGroups(result);
      setLoaded(true);
      serverSave(CACHE_KEY, result).catch(() => {});

      const totalInvites = result.reduce((s, g) => s + g.promos.filter(p => p.isInvite).length, 0);
      const totalActive  = result.reduce((s, g) => s + g.promos.filter(p => !p.isInvite).length, 0);
      toast.success(`${totalInvites} convite(s) · ${totalActive} promoção(ões) ativa(s)`);

    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  }, [products, userId, mlConnected, loaded]);

  // ── Aceitar / Recusar ─────────────────────────────────────────────────────
  // ── Abre modal de confirmação ─────────────────────────────────────────────
  const openConfirm = useCallback((g: ProductGroup, promo: Promo) => {
    const commission  = 0.12; // fallback — usar fee do produto se disponível
    const discDec     = promo.discountPct || (promo.sellerPct || 0) + (promo.meliPct || 0) || 0.05;
    const price       = promo.currentPrice || g.currentPrice;
    const finalPrice  = promo.suggestedPrice || Math.round(price * (1 - discDec) * 100) / 100;
    const youReceive  = Math.round(finalPrice * (1 - commission) * 100) / 100;
    setConfirm({ group: g, promo, discountPct: discDec * 100, finalPrice, youReceive });
  }, []);

  // ── Recalcula quando usuário edita o % ────────────────────────────────────
  const updateConfirmDiscount = useCallback((pct: number) => {
    setConfirm(prev => {
      if (!prev) return prev;
      const commission = 0.12;
      const price      = prev.promo.currentPrice || prev.group.currentPrice;
      const finalPrice = Math.round(price * (1 - pct / 100) * 100) / 100;
      const youReceive = Math.round(finalPrice * (1 - commission) * 100) / 100;
      return { ...prev, discountPct: pct, finalPrice, youReceive };
    });
  }, []);

  // ── Confirma participação ─────────────────────────────────────────────────
  const handleAccept = useCallback(async (g: ProductGroup, promo: Promo, discountPct: number) => {
    const key = `${g.mlItemId}-${promo.promotionId}`;
    setActingKey(key);
    setConfirm(null);
    try {
      if (!promo.promotionId) throw new Error("ID da promoção não encontrado. Recarregue a lista.");

      const type       = promo.promotionType;
      const price      = promo.currentPrice || g.currentPrice;
      const dealPrice  = Math.round(price * (1 - discountPct / 100) * 100) / 100;

      if (type === "PRICE_DISCOUNT") {
        await proxyPost("PUT",
          `/seller-promotions/${promo.promotionId}/items/${g.mlItemId}?app_version=v2`,
          { price: dealPrice }
        );
      } else if (["DEAL", "DOD", "LIGHTNING"].includes(type)) {
        await proxyPost("POST",
          `/seller-promotions/items/${g.mlItemId}?app_version=v2`,
          { promotion_type: type, promotion_id: promo.promotionId, deal_price: dealPrice }
        );
      } else {
        await proxyPost("POST",
          `/seller-promotions/items/${g.mlItemId}?app_version=v2`,
          { promotion_type: type, promotion_id: promo.promotionId }
        );
      }

      toast.success("Participando da promoção!");
      setGroups(prev => prev.map(gr => gr.mlItemId !== g.mlItemId ? gr : {
        ...gr,
        promos: gr.promos.map(p =>
          p.promotionId !== promo.promotionId ? p : { ...p, isInvite: false, status: "active" }
        ),
      }));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("invalid_promotion") || msg.includes("invalid promotion")) {
        toast.error("Promoção inválida ou expirada. Recarregue a lista.");
      } else {
        toast.error("Erro ao participar: " + msg);
      }
    } finally {
      setActingKey(null);
    }
  }, []);

  const handleDecline = useCallback(async (g: ProductGroup, promo: Promo) => {
    const key = `${g.mlItemId}-${promo.promotionId}`;
    setActingKey(key);
    try {
      await proxyPost("DELETE",
        `/seller-promotions/items/${g.mlItemId}?promotion_type=${promo.promotionType}&promotion_id=${promo.promotionId}&app_version=v2`
      );
      toast.success("Recusado.");
      setGroups(prev => prev.map(gr => gr.mlItemId !== g.mlItemId ? gr : {
        ...gr,
        promos: gr.promos.filter(p => p.promotionId !== promo.promotionId)
      }).filter(gr => gr.promos.length > 0));
    } catch (e) { toast.error("Erro: " + (e as Error).message); }
    finally { setActingKey(null); }
  }, []);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = groups;
    if (filterStatus === "invite") list = list.filter(g => g.promos.some(p => p.isInvite));
    if (filterStatus === "active") list = list.filter(g => g.promos.some(p => !p.isInvite));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.mlItemId.toLowerCase().includes(q) ||
        g.sku.toLowerCase().includes(q)
      );
    }
    return list;
  }, [groups, filterStatus, search]);

  // KPIs
  const totalInvites = groups.reduce((s, g) => s + g.promos.filter(p => p.isInvite).length, 0);
  const totalActive  = groups.reduce((s, g) => s + g.promos.filter(p => !p.isInvite).length, 0);
  const mlItems      = products.filter(p => p.mlItemId);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard color="yellow" label="Convites pendentes" value={totalInvites} />
        <KpiCard color="green"  label="Promoções ativas"   value={totalActive} />
        <KpiCard color="blue"   label="Produtos com promoção" value={groups.length} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por título, MLB ou SKU..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex rounded-md border overflow-hidden">
          {([["all","Todos"],["invite","Convites"],["active","Ativas"]] as const).map(([v,l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${filterStatus === v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {l}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />{loadingStep || "Carregando..."}</>
            : <><RefreshCw className="h-4 w-4 mr-1.5" />{loaded ? "Atualizar" : "Carregar"}</>}
        </Button>
      </div>

      {/* Estado vazio */}
      {!loaded && !loading && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Tag className="h-10 w-10 mx-auto mb-3 opacity-20" />
          {!mlConnected
            ? <p>Conecte o Mercado Livre nas <strong>Configurações</strong>.</p>
            : mlItems.length === 0
            ? <p>Carregue os produtos na aba <strong>Precificação</strong> primeiro.</p>
            : <p>Clique em <strong>Carregar</strong> para buscar promoções.</p>}
        </CardContent></Card>
      )}

      {loaded && !loading && filtered.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nenhuma promoção encontrada.
          {groups.length === 0 && " Seus anúncios não têm promoções ativas ou convites pendentes."}
        </CardContent></Card>
      )}

      {/* Lista de produtos com promoções */}
      {/* ── Modal de confirmação ─────────────────────────────────────────── */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-background rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-base">Confirme os detalhes da promoção</h2>
              <button onClick={() => setConfirm(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Produto */}
            <div className="px-6 py-4 bg-muted/30 flex items-center gap-3">
              <img src={confirm.group.image} alt="" className="h-12 w-12 rounded-lg object-cover bg-muted shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
              <div>
                <div className="font-semibold text-sm line-clamp-2">{confirm.group.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Estoque total: {confirm.group.stock} unidades
                </div>
              </div>
            </div>

            {/* Detalhes */}
            <div className="px-6 py-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Promoção</span>
                <span className="font-medium">{TYPE_LABEL[confirm.promo.promotionType] || confirm.promo.promotionType}</span>
              </div>
              {confirm.promo.name && confirm.promo.name !== TYPE_LABEL[confirm.promo.promotionType] && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Campanha</span>
                  <span className="font-medium">{confirm.promo.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vigência</span>
                <span>{fmtDate(confirm.promo.startDate)} a {fmtDate(confirm.promo.endDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Preço original</span>
                <span className="font-semibold">{BRL(confirm.group.currentPrice)}</span>
              </div>
            </div>

            <div className="px-6 pb-4 space-y-4">
              {/* Desconto editável */}
              <div className="border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Desconto</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={confirm.promo.minPrice
                        ? Math.round((1 - confirm.promo.minPrice / confirm.group.currentPrice) * 100 * 10) / 10
                        : 1}
                      max={50}
                      step={0.5}
                      value={confirm.discountPct.toFixed(1)}
                      onChange={e => updateConfirmDiscount(parseFloat(e.target.value) || 0)}
                      className="w-20 text-right border rounded-lg px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-[#2D3277]"
                    />
                    <span className="text-sm font-semibold">%</span>
                  </div>
                </div>
                <div className="text-xs text-right text-muted-foreground">
                  Equivale a {BRL(confirm.group.currentPrice - confirm.finalPrice)}
                </div>
                {confirm.promo.minPrice && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Desconto mínimo</span>
                    <span>{((1 - confirm.promo.minPrice / confirm.group.currentPrice) * 100).toFixed(0)}%</span>
                  </div>
                )}
                {confirm.promo.sellerPct && confirm.promo.meliPct && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Você paga</span>
                    <span>{(confirm.promo.sellerPct * 100).toFixed(0)}% · ML paga {(confirm.promo.meliPct * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>

              {/* Preço final e você recebe */}
              <div className="border rounded-xl p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Preço final</span>
                  <div className="text-right">
                    <div className="font-bold text-[#2D3277] text-lg">{BRL(confirm.finalPrice)}</div>
                    <div className="text-xs text-muted-foreground line-through">{BRL(confirm.group.currentPrice)}</div>
                  </div>
                </div>
                <div className="flex justify-between text-sm border-t pt-3">
                  <span className="text-muted-foreground">Você recebe</span>
                  <div className="text-right">
                    <div className="font-bold text-green-700 text-lg">{BRL(confirm.youReceive)}</div>
                    {confirm.promo.meliDiscount && confirm.promo.meliDiscount > 0 && (
                      <div className="text-xs text-green-600">
                        Reduzimos {BRL(confirm.promo.meliDiscount)} das suas tarifas
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Aviso se desconto fora do range */}
              {confirm.promo.minPrice && confirm.finalPrice < confirm.promo.minPrice && (
                <div className="flex items-center gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Preço abaixo do mínimo permitido ({BRL(confirm.promo.minPrice)})
                </div>
              )}
            </div>

            {/* Botões */}
            <div className="px-6 pb-6 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirm(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-[#2D3277] hover:bg-[#1e2456] text-[#FFE600] font-bold"
                disabled={!!actingKey || (!!confirm.promo.minPrice && confirm.finalPrice < confirm.promo.minPrice)}
                onClick={() => handleAccept(confirm.group, confirm.promo, confirm.discountPct)}
              >
                {actingKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Confirmar participação
              </Button>
            </div>
          </div>
        </div>
      )}

      {filtered.map(g => {        const isOpen    = expanded.has(g.mlItemId);
        const invites   = g.promos.filter(p => p.isInvite);
        const actives   = g.promos.filter(p => !p.isInvite);

        return (
          <Card key={g.mlItemId} className={invites.length > 0 ? "border-yellow-300/60" : ""}>
            {/* Cabeçalho do produto */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => toggleExpand(g.mlItemId)}
            >
              {isOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}

              <img src={g.image} alt="" className="h-12 w-12 rounded-lg object-cover bg-muted shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate" title={g.name}>{g.name}</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                  <span className="font-mono">#{g.mlItemId}</span>
                  {g.sku && <span>SKU {g.sku}</span>}
                  <span>{BRL(g.currentPrice)}</span>
                  {g.stock > 0 && <span>Estoque: {g.stock} un.</span>}
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: g.listingType === "gold_pro" ? "#FFE600" : "#E8EDFF", color: "#2D3277" }}>
                    {LISTING_LABEL[g.listingType] || g.listingType}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {invites.length > 0 && (
                  <Badge className="bg-yellow-400/20 text-yellow-700 border-0">
                    {invites.length} convite{invites.length > 1 ? "s" : ""}
                  </Badge>
                )}
                {actives.length > 0 && (
                  <Badge className="bg-green-500/15 text-green-700 border-0">
                    {actives.length} ativa{actives.length > 1 ? "s" : ""}
                  </Badge>
                )}
                <a href={`https://www.mercadolivre.com.br/anuncios/${g.mlItemId}/promocoes`}
                  target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-blue-500 hover:text-blue-700">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* Tabela de promoções (expandida) */}
            {isOpen && (
              <div className="border-t">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">Promoção</th>
                      <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">Estado e vigência</th>
                      <th className="text-right font-medium px-3 py-2.5">Desconto</th>
                      <th className="text-right font-medium px-3 py-2.5">Preço final</th>
                      <th className="text-right font-medium px-3 py-2.5">Você recebe</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.promos.map(promo => {
                      const actKey = `${g.mlItemId}-${promo.promotionId}`;
                      const acting = actingKey === actKey;
                      const ss     = STATUS_STYLE[promo.status] || STATUS_STYLE.finished;

                      // discountPct já normalizado para decimal no montagem
                      const discPctDisplay = promo.discountPct && promo.discountPct > 0
                        ? (promo.discountPct * 100).toFixed(0) + "%"
                        : null;

                      return (
                        <tr key={actKey} className="border-t hover:bg-muted/20">
                          {/* Tipo */}
                          <td className="px-4 py-3">
                            <div className="font-medium text-sm">
                              {TYPE_LABEL[promo.promotionType] || promo.promotionType}
                            </div>
                            {promo.name && promo.name !== TYPE_LABEL[promo.promotionType] && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={promo.name}>
                                {promo.name}
                              </div>
                            )}
                            {promo.meliPct && promo.meliPct > 0 && (
                              <div className="text-xs text-green-700 mt-0.5">
                                ML subsidia {(promo.meliPct * 100).toFixed(0)}%
                              </div>
                            )}
                          </td>

                          {/* Estado e vigência */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <Badge className={`${ss.cls} text-xs mb-1`}>{ss.label}</Badge>
                            {(promo.startDate || promo.endDate) && (
                              <div className="text-xs text-muted-foreground">
                                {fmtDate(promo.startDate)} a {fmtDate(promo.endDate)}
                              </div>
                            )}
                            {promo.deadlineDate && promo.isInvite && (
                              <div className="text-xs text-orange-600">
                                Prazo: {fmtDate(promo.deadlineDate)}
                              </div>
                            )}
                          </td>

                          {/* Desconto */}
                          <td className="px-3 py-3 text-right">
                            {discPctDisplay ? (
                              <div>
                                <div className="font-semibold">
                                  {promo.finalPrice && promo.currentPrice
                                    ? BRL(promo.currentPrice - promo.finalPrice)
                                    : discPctDisplay}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {discPctDisplay}
                                  {promo.sellerPct && promo.meliPct
                                    ? ` (você ${(promo.sellerPct * 100).toFixed(0)}% + ML ${(promo.meliPct * 100).toFixed(0)}%)`
                                    : ""}
                                </div>
                              </div>
                            ) : promo.minPrice ? (
                              <div>
                                <div className="text-xs text-muted-foreground">Mín {BRL(promo.minPrice)}</div>
                                {promo.maxPrice && <div className="text-xs text-muted-foreground">Máx {BRL(promo.maxPrice)}</div>}
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>

                          {/* Preço final */}
                          <td className="px-3 py-3 text-right">
                            {promo.finalPrice ? (
                              <div>
                                <div className="font-bold text-[#2D3277]">{BRL(promo.finalPrice)}</div>
                                <div className="text-xs text-muted-foreground line-through">{BRL(g.currentPrice)}</div>
                              </div>
                            ) : promo.suggestedPrice ? (
                              <div>
                                <div className="font-bold text-[#2D3277]">{BRL(promo.suggestedPrice)}</div>
                                <div className="text-xs text-muted-foreground">sugerido</div>
                              </div>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </td>

                          {/* Você recebe */}
                          <td className="px-3 py-3 text-right">
                            {promo.youReceive ? (
                              <div>
                                <div className="font-semibold text-green-700">{BRL(promo.youReceive)}</div>
                                {promo.meliDiscount && promo.meliDiscount > 0 && (
                                  <div className="text-xs text-green-600">
                                    Reduzimos {BRL(promo.meliDiscount)} das tarifas
                                  </div>
                                )}
                              </div>
                            ) : <span className="text-muted-foreground text-xs">—</span>}
                          </td>

                          {/* Ações */}
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            {promo.isInvite ? (
                              <div className="flex items-center gap-1.5 justify-end">
                                <Button size="sm"
                                  className="bg-[#2D3277] hover:bg-[#1e2456] text-[#FFE600] h-7 text-xs px-3"
                                  onClick={() => openConfirm(g, promo)}
                                  disabled={!!actingKey}>
                                  {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Participar"}
                                </Button>
                                <button
                                  className="text-xs text-muted-foreground hover:text-red-600 transition-colors p-1"
                                  onClick={() => handleDecline(g, promo)}
                                  disabled={!!actingKey}
                                  title="Recusar">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs px-3"
                                onClick={async () => {
                                  // Pausar/encerrar promoção ativa
                                  try {
                                    await proxyPost("DELETE",
                                      `/seller-promotions/items/${g.mlItemId}?promotion_type=${promo.promotionType}&promotion_id=${promo.promotionId}&app_version=v2`
                                    );
                                    toast.success("Promoção encerrada.");
                                    setGroups(prev => prev.map(gr => gr.mlItemId !== g.mlItemId ? gr : {
                                      ...gr, promos: gr.promos.filter(p => p.promotionId !== promo.promotionId)
                                    }).filter(gr => gr.promos.length > 0));
                                  } catch (e) { toast.error("Erro: " + (e as Error).message); }
                                }}>
                                Alterar
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: number; color: "yellow"|"green"|"blue" }) {
  const cls = {
    yellow: "bg-yellow-500/10 text-yellow-600",
    green:  "bg-green-500/10 text-green-600",
    blue:   "bg-primary/10 text-primary",
  }[color];
  const Icon = color === "yellow" ? Tag : color === "green" ? Check : Tag;
  return (
    <Card><CardContent className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${cls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </div>
    </CardContent></Card>
  );
}
