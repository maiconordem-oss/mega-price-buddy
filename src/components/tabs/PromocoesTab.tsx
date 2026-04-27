import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ml, proxyPost, serverSave, serverLoad, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Tag, Check, X } from "lucide-react";

interface PromoItem {
  itemId: string;
  name: string;
  image: string;
  currentPrice: number;
  promotionType: string;
  promotionId: string;
  status: string;
  minPrice?: number;
  maxPrice?: number;
  suggestedPrice?: number;
  sellerPct?: number;
  meliPct?: number;
  deadlineDate?: string;
  finishDate?: string;
  isInvite: boolean;
}

const CACHE_KEY = "promocoes";
const CACHE_TTL = 60;

const PROMO_LABELS: Record<string, string> = {
  DEAL: "Deal do Dia",
  DOD: "Oferta do Dia",
  SELLER_CAMPAIGN: "Campanha Vendedor",
  MARKETPLACE_CAMPAIGN: "Campanha ML",
  LIGHTNING: "Relâmpago",
  PRICE_DISCOUNT: "Desconto Preço",
};

function isValidInvite(o: PromoItem): boolean {
  const now = new Date();
  if (o.deadlineDate && new Date(o.deadlineDate) < now) return false;
  if (o.finishDate && new Date(o.finishDate) < now) return false;
  return true;
}

export function PromocoesTab() {
  const { products } = useProducts();
  const { userId } = useAuth();
  const [data, setData] = useState<PromoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "invites" | "active">("invites");
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (force = false) => {
      if (!products.length) { toast.info("Carregue os produtos primeiro."); return; }
      if (!userId) { toast.info("Conecte o Mercado Livre."); return; }
      if (!force && loaded) return;

      if (!force) {
        try {
          const cached = await serverLoad<PromoItem[]>(CACHE_KEY);
          if (cached?.data && cached?.ts) {
            const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
            if (age < CACHE_TTL) { setData(cached.data); setLoaded(true); return; }
          }
        } catch {}
      }

      setLoading(true);
      const now = new Date();
      const result: PromoItem[] = [];

      try {
        // Busca promoções de cada produto ML
        const mlItems = products.filter((p) => p.mlItemId);

        // Processa em lotes de 5 para não sobrecarregar
        for (let i = 0; i < mlItems.length; i += 5) {
          const batch = mlItems.slice(i, i + 5);
          await Promise.all(
            batch.map(async (p) => {
              try {
                const res = await ml(`/seller-promotions/items/${p.mlItemId}?app_version=v2`) as {
                  results?: Array<{
                    promotion_type: string;
                    id: string;
                    status: { id: string } | string;
                    min_discounted_price?: number;
                    max_discounted_price?: number;
                    suggested_discounted_price?: number;
                    seller_percentage?: number;
                    meli_percentage?: number;
                    deadline_date?: string;
                    finish_date?: string;
                    end_date?: string;
                  }>;
                };

                for (const o of res.results || []) {
                  const type = o.promotion_type;
                  if (["SMART", "PRICE_MATCHING"].includes(type)) continue;

                  const statusStr = String((o.status as { id?: string })?.id || o.status || "").toLowerCase();
                  const isInvite = ["candidate", "invited", "pending"].includes(statusStr);
                  const isActive = ["started", "active"].includes(statusStr);

                  if (!isInvite && !isActive) continue;

                  const deadlineDate = o.deadline_date;
                  const finishDate = o.finish_date || o.end_date;

                  // Filtro de convites expirados
                  if (isInvite) {
                    if (deadlineDate && new Date(deadlineDate) < now) continue;
                    if (type === "PRICE_DISCOUNT" && !deadlineDate) continue;
                    if (type === "LIGHTNING" && !deadlineDate) continue;
                  }

                  const listing = p.listings.find((l) => l.channel === "ml");
                  result.push({
                    itemId: p.mlItemId!,
                    name: p.name,
                    image: p.image,
                    currentPrice: listing?.currentPrice || 0,
                    promotionType: type,
                    promotionId: o.id,
                    status: statusStr,
                    minPrice: o.min_discounted_price,
                    maxPrice: o.max_discounted_price,
                    suggestedPrice: o.suggested_discounted_price,
                    sellerPct: o.seller_percentage,
                    meliPct: o.meli_percentage,
                    deadlineDate,
                    finishDate,
                    isInvite,
                  });
                }
              } catch {}
            }),
          );
        }

        setData(result);
        setLoaded(true);
        serverSave(CACHE_KEY, result).catch(() => {});
        const invites = result.filter((r) => r.isInvite).length;
        toast.success(`${result.length} promoções • ${invites} convite(s) pendente(s)`);
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [products, userId, loaded],
  );

  const handleAccept = useCallback(async (item: PromoItem, dealPrice?: number) => {
    const key = item.itemId + item.promotionId;
    setActingIds((prev) => new Set(prev).add(key));
    try {
      const body: Record<string, unknown> = {
        promotion_type: item.promotionType,
        promotion_id: item.promotionId,
      };
      if (dealPrice) body.deal_price = dealPrice;

      await proxyPost("POST", `/seller-promotions/items/${item.itemId}?app_version=v2`, body);
      toast.success("Convite aceito com sucesso!");
      setData((prev) => prev.map((d) =>
        d.itemId === item.itemId && d.promotionId === item.promotionId
          ? { ...d, isInvite: false, status: "started" }
          : d,
      ));
    } catch (e) {
      toast.error("Erro ao aceitar: " + (e as Error).message);
    } finally {
      setActingIds((prev) => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  const handleDecline = useCallback(async (item: PromoItem) => {
    const key = item.itemId + item.promotionId;
    setActingIds((prev) => new Set(prev).add(key));
    try {
      await proxyPost(
        "DELETE",
        `/seller-promotions/items/${item.itemId}?promotion_type=${item.promotionType}&promotion_id=${item.promotionId}&app_version=v2`,
      );
      toast.success("Convite recusado.");
      setData((prev) => prev.filter((d) => !(d.itemId === item.itemId && d.promotionId === item.promotionId)));
    } catch (e) {
      toast.error("Erro ao recusar: " + (e as Error).message);
    } finally {
      setActingIds((prev) => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  const filtered = data.filter((d) => {
    if (filter === "invites" && !d.isInvite) return false;
    if (filter === "active" && d.isInvite) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase()) && !d.itemId.includes(search)) return false;
    return true;
  });

  const inviteCount = data.filter((d) => d.isInvite && isValidInvite(d)).length;
  const activeCount = data.filter((d) => !d.isInvite).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-yellow-500/10 text-yellow-600 flex items-center justify-center"><Tag /></div>
          <div><div className="text-xs text-muted-foreground">Convites Pendentes</div><div className="text-2xl font-bold">{inviteCount}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-green-500/10 text-green-600 flex items-center justify-center"><Check /></div>
          <div><div className="text-xs text-muted-foreground">Promoções Ativas</div><div className="text-2xl font-bold">{activeCount}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">∑</div>
          <div><div className="text-xs text-muted-foreground">Total Promoções</div><div className="text-2xl font-bold">{data.length}</div></div>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {([["all", "Todos"], ["invites", "Convites"], ["active", "Ativas"]] as const).map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)}>{l}</Button>
        ))}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Carregar"}
        </Button>
      </div>

      {/* Invites cards */}
      {filter !== "active" && filtered.filter((d) => d.isInvite).length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Convites para aceitar</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.filter((d) => d.isInvite).map((item) => {
              const key = item.itemId + item.promotionId;
              const acting = actingIds.has(key);
              const needsDealPrice = ["DEAL", "DOD", "LIGHTNING"].includes(item.promotionType);
              return (
                <Card key={key} className="border-yellow-300/50 bg-yellow-50/50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex gap-3 items-start">
                      <img src={item.image} className="h-12 w-12 rounded-lg object-cover bg-muted shrink-0" alt=""
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate" title={item.name}>{item.name}</div>
                        <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs mt-0.5">
                          {PROMO_LABELS[item.promotionType] || item.promotionType}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white rounded-md p-2">
                        <div className="text-muted-foreground">Preço atual</div>
                        <div className="font-semibold">{BRL(item.currentPrice)}</div>
                      </div>
                      {item.suggestedPrice && (
                        <div className="bg-white rounded-md p-2">
                          <div className="text-muted-foreground">Preço sugerido</div>
                          <div className="font-semibold text-green-700">{BRL(item.suggestedPrice)}</div>
                        </div>
                      )}
                      {item.minPrice && (
                        <div className="bg-white rounded-md p-2">
                          <div className="text-muted-foreground">Preço mínimo</div>
                          <div className="font-semibold text-red-600">{BRL(item.minPrice)}</div>
                        </div>
                      )}
                      {item.maxPrice && (
                        <div className="bg-white rounded-md p-2">
                          <div className="text-muted-foreground">Preço máximo</div>
                          <div className="font-semibold">{BRL(item.maxPrice)}</div>
                        </div>
                      )}
                      {item.sellerPct !== undefined && (
                        <div className="bg-white rounded-md p-2">
                          <div className="text-muted-foreground">Seu desconto</div>
                          <div className="font-semibold">{(item.sellerPct * 100).toFixed(0)}%</div>
                        </div>
                      )}
                      {item.meliPct !== undefined && (
                        <div className="bg-white rounded-md p-2">
                          <div className="text-muted-foreground">Desconto ML</div>
                          <div className="font-semibold">{(item.meliPct * 100).toFixed(0)}%</div>
                        </div>
                      )}
                    </div>
                    {item.deadlineDate && (
                      <div className="text-xs text-muted-foreground">
                        ⏰ Prazo: {new Date(item.deadlineDate).toLocaleDateString("pt-BR")}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleAccept(item, needsDealPrice ? item.suggestedPrice : undefined)}
                        disabled={acting}
                      >
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

      {/* Active table */}
      {filter !== "invites" && filtered.filter((d) => !d.isInvite).length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Promoções Ativas</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {["Produto", "Tipo", "Status", "Preço Atual", "Encerra"].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.filter((d) => !d.isInvite).map((item) => (
                  <tr key={item.itemId + item.promotionId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium max-w-[180px]">
                      <div className="flex items-center gap-2">
                        <img src={item.image} className="h-8 w-8 rounded object-cover bg-muted shrink-0" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <span className="truncate" title={item.name}>{item.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className="bg-primary/10 text-primary border-0 text-xs">
                        {PROMO_LABELS[item.promotionType] || item.promotionType}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className="bg-green-500/15 text-green-700 border-0">Ativa</Badge>
                    </td>
                    <td className="px-3 py-2 font-semibold">{BRL(item.currentPrice)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.finishDate ? new Date(item.finishDate).toLocaleDateString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!loaded && !loading && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <Tag className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p>Clique em <strong>Carregar</strong> para buscar convites e promoções ativas.</p>
        </CardContent></Card>
      )}
      {loaded && filtered.length === 0 && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          Nenhuma promoção encontrada com os filtros selecionados.
        </CardContent></Card>
      )}
    </div>
  );
}
