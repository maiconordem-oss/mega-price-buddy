import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ml, proxyPost, serverSave, serverLoad, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useShopReset } from "@/hooks/useShopReset";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Tag, Check, X, AlertTriangle } from "lucide-react";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface RawPromo {
  promotion_type:           string;
  id:                       string;
  status:                   { id: string } | string;
  min_discounted_price?:    number;
  max_discounted_price?:    number;
  suggested_discounted_price?: number;
  seller_percentage?:       number;
  meli_percentage?:         number;
  deadline_date?:           string;
  finish_date?:             string;
  end_date?:                string;
  [key: string]: unknown;
}

interface PromoItem {
  itemId:         string;
  name:           string;
  image:          string;
  currentPrice:   number;
  promotionType:  string;
  promotionId:    string;
  status:         string;
  minPrice?:      number;
  maxPrice?:      number;
  suggestedPrice?: number;
  sellerPct?:     number;
  meliPct?:       number;
  deadlineDate?:  string;
  finishDate?:    string;
  isInvite:       boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CACHE_KEY = "promocoes";
const CACHE_TTL = 60; // 1h

const IGNORE_TYPES = ["SMART", "PRICE_MATCHING"];
const INVITE_STATUSES = ["candidate", "invited", "pending"];
const ACTIVE_STATUSES = ["started", "active"];
const NEEDS_DEAL_PRICE = ["DEAL", "DOD", "LIGHTNING"];

const PROMO_LABELS: Record<string, string> = {
  DEAL:                 "Deal do Dia",
  DOD:                  "Oferta do Dia",
  SELLER_CAMPAIGN:      "Campanha Vendedor",
  MARKETPLACE_CAMPAIGN: "Campanha ML",
  LIGHTNING:            "Relâmpago",
  PRICE_DISCOUNT:       "Desconto Preço",
  VOLUME:               "Volume",
  UNHEALTHY_STOCK:      "Liquidação Full",
  PRE_NEGOTIATED:       "Pré-Negociado",
  SELLER_COUPON_CAMPAIGN: "Cupom",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusStr(raw: RawPromo): string {
  const s = raw.status;
  if (!s) return "";
  if (typeof s === "string") return s.toLowerCase();
  if (typeof s === "object" && "id" in s) return String(s.id).toLowerCase();
  return "";
}

function extractPromos(raw: unknown): RawPromo[] {
  if (!raw) return [];
  // Formato array direto: [{ promotion_type, id, ... }]
  if (Array.isArray(raw)) return raw as RawPromo[];
  const obj = raw as Record<string, unknown>;
  // Formato { results: [...] }
  if (Array.isArray(obj.results)) return obj.results as RawPromo[];
  // Formato { promotions: [...] }
  if (Array.isArray(obj.promotions)) return obj.promotions as RawPromo[];
  // Formato { data: [...] }
  if (Array.isArray(obj.data)) return obj.data as RawPromo[];
  // Objeto único
  if (obj.promotion_type) return [obj as RawPromo];
  return [];
}

function isExpired(date?: string): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}

// ── Componente ────────────────────────────────────────────────────────────────

export function PromocoesTab() {
  const { products } = useProducts();
  const { userId, mlConnected } = useAuth();

  const [data,       setData]       = useState<PromoItem[]>([]);
  const [loaded,     setLoaded]     = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [search,     setSearch]     = useState("");
  const [filter,     setFilter]     = useState<"all" | "invites" | "active">("invites");
  const [actingIds,  setActingIds]  = useState<Set<string>>(new Set());
  const [errors,     setErrors]     = useState<string[]>([]);

  useShopReset(useCallback(() => {
    setData([]); setLoaded(false); setErrors([]);
  }, []));

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) {
      toast.info("Conecte o Mercado Livre primeiro.");
      return;
    }

    const mlItems = products.filter(p => p.mlItemId);
    if (!mlItems.length) {
      toast.info("Carregue os produtos do ML na aba Precificação primeiro.");
      return;
    }

    if (!force && loaded) return;

    // Cache
    if (!force) {
      try {
        const cached = await serverLoad<PromoItem[]>(CACHE_KEY);
        if (cached?.data && cached?.ts) {
          const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
          if (age < CACHE_TTL) {
            setData(cached.data);
            setLoaded(true);
            return;
          }
        }
      } catch {}
    }

    setLoading(true);
    setErrors([]);
    const result: PromoItem[] = [];
    const errs: string[] = [];
    const now = new Date();

    try {
      // Processa em lotes de 5
      for (let i = 0; i < mlItems.length; i += 5) {
        const batch = mlItems.slice(i, i + 5);
        setLoadingStep(`Buscando promoções ${i + 1}–${Math.min(i + 5, mlItems.length)} de ${mlItems.length}...`);

        await Promise.all(batch.map(async p => {
          try {
            const raw = await ml(`/seller-promotions/items/${p.mlItemId}?app_version=v2`);
            const promos = extractPromos(raw);
            const listing = p.listings.find(l => l.channel === "ml");

            for (const o of promos) {
              const type      = o.promotion_type;
              const statusStr = getStatusStr(o);

              // Ignora tipos automáticos
              if (IGNORE_TYPES.includes(type)) continue;

              const isInvite = INVITE_STATUSES.includes(statusStr);
              const isActive = ACTIVE_STATUSES.includes(statusStr);
              if (!isInvite && !isActive) continue;

              const deadlineDate = o.deadline_date;
              const finishDate   = o.finish_date || o.end_date;

              // Filtra convites expirados
              if (isInvite) {
                if (isExpired(deadlineDate)) continue;
                if (isExpired(finishDate))   continue;
                // PRICE_DISCOUNT e LIGHTNING sem deadline = automático, ignora
                if ((type === "PRICE_DISCOUNT" || type === "LIGHTNING") && !deadlineDate) continue;
              }

              result.push({
                itemId:        p.mlItemId!,
                name:          p.name,
                image:         p.image,
                currentPrice:  listing?.currentPrice || 0,
                promotionType: type,
                promotionId:   o.id,
                status:        statusStr,
                minPrice:      o.min_discounted_price,
                maxPrice:      o.max_discounted_price,
                suggestedPrice: o.suggested_discounted_price,
                sellerPct:     o.seller_percentage,
                meliPct:       o.meli_percentage,
                deadlineDate,
                finishDate,
                isInvite,
              });
            }
          } catch (e) {
            const msg = (e as Error).message;
            // 404 = produto sem promoções (normal), ignora
            if (!msg.includes("404") && !msg.includes("not found")) {
              errs.push(`${p.mlItemId}: ${msg}`);
            }
          }
        }));

        await new Promise(r => setTimeout(r, 200));
      }

      setData(result);
      setLoaded(true);
      setErrors(errs);
      serverSave(CACHE_KEY, result).catch(() => {});

      const invites = result.filter(r => r.isInvite).length;
      const actives = result.filter(r => !r.isInvite).length;
      toast.success(`${invites} convite(s) pendente(s) · ${actives} promoção(ões) ativa(s)`);

    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  }, [products, userId, mlConnected, loaded]);

  // ── Aceitar convite ───────────────────────────────────────────────────────
  const handleAccept = useCallback(async (item: PromoItem, dealPrice?: number) => {
    const key = item.itemId + item.promotionId;
    setActingIds(prev => new Set(prev).add(key));
    try {
      const body: Record<string, unknown> = {
        promotion_type: item.promotionType,
        promotion_id:   item.promotionId,
      };
      if (dealPrice) body.deal_price = dealPrice;
      await proxyPost("POST", `/seller-promotions/items/${item.itemId}?app_version=v2`, body);
      toast.success("Convite aceito!");
      setData(prev => prev.map(d =>
        d.itemId === item.itemId && d.promotionId === item.promotionId
          ? { ...d, isInvite: false, status: "started" }
          : d
      ));
    } catch (e) {
      toast.error("Erro ao aceitar: " + (e as Error).message);
    } finally {
      setActingIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  // ── Recusar convite ───────────────────────────────────────────────────────
  const handleDecline = useCallback(async (item: PromoItem) => {
    const key = item.itemId + item.promotionId;
    setActingIds(prev => new Set(prev).add(key));
    try {
      await proxyPost(
        "DELETE",
        `/seller-promotions/items/${item.itemId}?promotion_type=${item.promotionType}&promotion_id=${item.promotionId}&app_version=v2`,
      );
      toast.success("Convite recusado.");
      setData(prev => prev.filter(d =>
        !(d.itemId === item.itemId && d.promotionId === item.promotionId)
      ));
    } catch (e) {
      toast.error("Erro ao recusar: " + (e as Error).message);
    } finally {
      setActingIds(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const filtered = data.filter(d => {
    if (filter === "invites" && !d.isInvite)  return false;
    if (filter === "active"  &&  d.isInvite)  return false;
    if (search) {
      const q = search.toLowerCase();
      if (!d.name.toLowerCase().includes(q) && !d.itemId.includes(q)) return false;
    }
    return true;
  });

  const inviteCount = data.filter(d => d.isInvite).length;
  const activeCount = data.filter(d => !d.isInvite).length;
  const mlItems     = products.filter(p => p.mlItemId);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-yellow-500/10 text-yellow-600 flex items-center justify-center"><Tag className="h-5 w-5" /></div>
          <div><div className="text-xs text-muted-foreground">Convites Pendentes</div><div className="text-2xl font-bold">{inviteCount}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-green-500/10 text-green-600 flex items-center justify-center"><Check className="h-5 w-5" /></div>
          <div><div className="text-xs text-muted-foreground">Promoções Ativas</div><div className="text-2xl font-bold">{activeCount}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <span className="font-bold text-sm">{mlItems.length}</span>
          </div>
          <div><div className="text-xs text-muted-foreground">Anúncios verificados</div><div className="text-2xl font-bold">{data.length}</div></div>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar produto ou MLB..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {([ ["all","Todos"], ["invites","Convites"], ["active","Ativas"] ] as const).map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)}>{l}</Button>
        ))}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />{loadingStep || "Carregando..."}</>
            : <><RefreshCw className="h-4 w-4 mr-1" />{loaded ? "Atualizar" : "Carregar"}</>}
        </Button>
      </div>

      {/* Erros não críticos */}
      {errors.length > 0 && (
        <Card className="border-orange-200">
          <CardContent className="p-3 flex gap-2 items-start">
            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
            <div className="text-xs text-orange-700">
              <span className="font-medium">{errors.length} produto(s) com erro ao buscar promoções:</span>
              <div className="mt-1 space-y-0.5 text-muted-foreground">
                {errors.slice(0, 3).map((e, i) => <div key={i}>{e}</div>)}
                {errors.length > 3 && <div>...e mais {errors.length - 3}</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado vazio inicial */}
      {!loaded && !loading && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Tag className="h-10 w-10 mx-auto mb-3 opacity-30" />
          {!mlConnected
            ? <p>Conecte o Mercado Livre nas <strong>Configurações</strong> para ver promoções.</p>
            : mlItems.length === 0
            ? <p>Carregue os produtos do ML na aba <strong>Precificação</strong> primeiro.</p>
            : <p>Clique em <strong>Carregar</strong> para buscar convites e promoções ativas.</p>}
        </CardContent></Card>
      )}

      {/* Loading */}
      {loading && (
        <Card><CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
          <p className="text-sm text-muted-foreground">{loadingStep}</p>
        </CardContent></Card>
      )}

      {/* Sem resultados */}
      {loaded && !loading && filtered.length === 0 && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          {data.length === 0
            ? <p>Nenhuma promoção ou convite encontrado para seus anúncios.</p>
            : <p>Nenhuma promoção encontrada com os filtros selecionados.</p>}
        </CardContent></Card>
      )}

      {/* Cards de convites */}
      {!loading && filter !== "active" && filtered.filter(d => d.isInvite).length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
            Convites para aceitar ({filtered.filter(d => d.isInvite).length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.filter(d => d.isInvite).map(item => {
              const key    = item.itemId + item.promotionId;
              const acting = actingIds.has(key);
              const needsDealPrice = NEEDS_DEAL_PRICE.includes(item.promotionType);
              return (
                <Card key={key} className="border-yellow-300/50 bg-yellow-50/30">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex gap-3 items-start">
                      <img src={item.image} className="h-12 w-12 rounded-lg object-cover bg-muted shrink-0" alt=""
                        onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm line-clamp-2" title={item.name}>{item.name}</div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs">
                            {PROMO_LABELS[item.promotionType] || item.promotionType}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">{item.itemId}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <InfoBox label="Preço atual"     value={BRL(item.currentPrice)} />
                      {item.suggestedPrice && <InfoBox label="Sugerido" value={BRL(item.suggestedPrice)} color="green" />}
                      {item.minPrice       && <InfoBox label="Mínimo"   value={BRL(item.minPrice)}       color="red" />}
                      {item.maxPrice       && <InfoBox label="Máximo"   value={BRL(item.maxPrice)} />}
                      {item.sellerPct !== undefined && (
                        <InfoBox label="Seu desconto" value={`${(item.sellerPct * 100).toFixed(0)}%`} />
                      )}
                      {item.meliPct !== undefined && (
                        <InfoBox label="Desconto ML" value={`${(item.meliPct * 100).toFixed(0)}%`} color="green" />
                      )}
                    </div>

                    {item.deadlineDate && (
                      <div className="text-xs text-orange-700 flex items-center gap-1">
                        <span>⏰</span>
                        <span>Prazo: {new Date(item.deadlineDate).toLocaleDateString("pt-BR")}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleAccept(item, needsDealPrice ? item.suggestedPrice : undefined)}
                        disabled={acting}>
                        {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                        Aceitar
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => handleDecline(item)} disabled={acting}>
                        <X className="h-3 w-3 mr-1" /> Recusar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabela de ativas */}
      {!loading && filter !== "invites" && filtered.filter(d => !d.isInvite).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Promoções Ativas ({filtered.filter(d => !d.isInvite).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {["Produto","Tipo","Preço Atual","Encerra"].map(h => (
                    <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.filter(d => !d.isInvite).map(item => (
                  <tr key={item.itemId + item.promotionId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 max-w-[220px]">
                      <div className="flex items-center gap-2">
                        <img src={item.image} className="h-8 w-8 rounded object-cover bg-muted shrink-0" alt=""
                          onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
                        <div>
                          <div className="truncate font-medium" title={item.name}>{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{item.itemId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className="bg-primary/10 text-primary border-0 text-xs">
                        {PROMO_LABELS[item.promotionType] || item.promotionType}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-semibold">{BRL(item.currentPrice)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.finishDate
                        ? new Date(item.finishDate).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function InfoBox({ label, value, color }: { label: string; value: string; color?: "green"|"red" }) {
  return (
    <div className="bg-white/80 border border-border/50 rounded-md p-2">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={`font-semibold text-xs ${color === "green" ? "text-green-700" : color === "red" ? "text-red-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
