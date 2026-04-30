import { useMemo, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Package, TrendingUp, CheckCircle2, AlertTriangle, Loader2, Download, Search, Clock, Tag } from "lucide-react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePromocoes } from "@/contexts/PromocoesContext";
import { computePricingRow, BRL, getTierDeductions } from "@/lib/pricing";
import { proxyPost } from "@/services/ml-api";
import { toast } from "sonner";
import type { Product } from "@/types/marketplace";

// Limite de aumento acumulado: 5% em 7 dias — namespace por shopId para não misturar contas
const PRICE_HIST_KEY = (shopId: string, itemId: string) => `price-hist:${shopId}:${itemId}`;
function getPriceHistory7d(shopId: string, itemId: string) {
  try {
    const raw = localStorage.getItem(PRICE_HIST_KEY(shopId, itemId));
    if (!raw) return [];
    const arr: Array<{ ts: number; pct: number }> = JSON.parse(raw);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return arr.filter((e) => e.ts >= cutoff);
  } catch { return []; }
}
function getAccumulated7d(shopId: string, itemId: string) {
  return getPriceHistory7d(shopId, itemId).reduce((s, e) => s + e.pct, 0);
}
function savePriceIncrease(shopId: string, itemId: string, pct: number) {
  const hist = getPriceHistory7d(shopId, itemId);
  hist.push({ ts: Date.now(), pct });
  localStorage.setItem(PRICE_HIST_KEY(shopId, itemId), JSON.stringify(hist));
}

export function PrecificacaoTab() {
  const { params, setParams, products, updateProduct, loadMLProducts, loadingProducts, saveProductCosts } = useProducts();
  const { userId, currentShop } = useAuth();
  const { activePromos } = usePromocoes();
  const shopId = currentShop?.id ?? "default";
  const [paramsOpen, setParamsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "low" | "ok" | "nocost">("");
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [expandedFuST, setExpandedFuST] = useState<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveProductCosts(), 1500);
  }, [saveProductCosts]);

  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());

  // auto-refresh de preços a cada 5 min
  useAutoRefresh(async () => {
    if (!loadMLProducts) return;
    await loadMLProducts(false);
    setLastPriceUpdate(new Date());
  }, 5 * 60 * 1000, !!userId);

  const rows = useMemo(() => {
    return products.map((p) => {
      // Se tem promoção ativa no ML e não tem promoPrice manual, usa o preço da promo
      const activePromo = p.mlItemId ? activePromos[p.mlItemId] : null;
      const effectiveProduct = activePromo && !(p.promoPrice ?? 0)
        ? { ...p, promoPrice: activePromo.finalPrice }
        : p;
      return { product: p, row: computePricingRow(effectiveProduct, params) };
    });
  }, [products, params, activePromos]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(({ product: p }) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.mlItemId || "").toLowerCase().includes(q),
      );
    }
    if (filterStatus === "low") list = list.filter(({ row }) => row.status === "low");
    if (filterStatus === "ok") list = list.filter(({ row }) => row.status === "ok");
    if (filterStatus === "nocost") list = list.filter(({ row }) => row.status === "nocost");
    return list;
  }, [rows, search, filterStatus]);

  // agrupa por SKU (produtos com mesmo SKU = mesmo produto físico, anuncios diferentes)
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const key = item.product.sku || item.product.mlItemId || item.product.name;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([sku, items]) => ({ sku, items }));
  }, [filtered]);

  const stats = useMemo(() => {
    let withCost = 0, low = 0, ok = 0;
    rows.forEach(({ row }) => {
      if (row.status !== "nocost") { withCost++; row.status === "ok" ? ok++ : low++; }
    });
    return { total: products.length, withCost, low, ok };
  }, [rows, products]);

  const tier1Total = (getTierDeductions(params, 1) * 100).toFixed(2);
  const tier2Total = (getTierDeductions(params, 2) * 100).toFixed(2);

  const handlePriceIncrease = useCallback(async (product: Product, pct: number) => {
    const itemId = product.mlItemId;
    if (!itemId) { toast.error("ID ML não disponível"); return; }

    const used = getAccumulated7d(shopId, itemId);
    const remaining = 5 - used;
    if (remaining <= 0) { toast.error("Limite de 5% em 7 dias atingido. Aguarde o período resetar."); return; }

    const actualPct = Math.min(pct, remaining);
    const currentPrice = product.listings.find((l) => l.channel === "ml")?.currentPrice ?? 0;
    const newPrice = parseFloat((currentPrice * (1 + actualPct / 100)).toFixed(2));

    if (!confirm(`Confirmar aumento de ${actualPct}%?\n\n"${product.name}"\n\n${BRL(currentPrice)} → ${BRL(newPrice)}`)) return;

    setUpdatingIds((prev) => new Set(prev).add(itemId));
    try {
      await proxyPost("PUT", `/items/${itemId}`, { price: newPrice });
      savePriceIncrease(shopId, itemId, actualPct);
      updateProduct(product.sku, {
        listings: product.listings.map((l) =>
          l.channel === "ml" ? { ...l, currentPrice: newPrice } : l,
        ),
      });
      toast.success(`Preço atualizado: ${BRL(newPrice)}`);
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    } finally {
      setUpdatingIds((prev) => { const s = new Set(prev); s.delete(itemId); return s; });
    }
  }, [updateProduct]);

  const handleSetIdealPrice = useCallback(async (product: Product, tier: 1 | 2) => {
    const itemId = product.mlItemId;
    if (!itemId) { toast.error("ID ML não disponível"); return; }
    const row = computePricingRow(product, params);
    const idealPrice = tier === 1 ? row.idealP : row.idealC;
    if (!idealPrice) { toast.error("Calcule o custo primeiro"); return; }
    const newPrice = parseFloat(idealPrice.toFixed(2));
    const currentPrice = product.listings.find((l) => l.channel === "ml")?.currentPrice ?? 0;
    if (!confirm(`Atualizar preço para o ideal ${tier === 1 ? "Premium" : "Clássico"}?\n\n"${product.name}"\n\n${BRL(currentPrice)} → ${BRL(newPrice)}`)) return;

    setUpdatingIds((prev) => new Set(prev).add(itemId + "ideal"));
    try {
      await proxyPost("PUT", `/items/${itemId}`, { price: newPrice });
      updateProduct(product.sku, {
        listings: product.listings.map((l) =>
          l.channel === "ml" ? { ...l, currentPrice: newPrice } : l,
        ),
      });
      toast.success(`Preço ideal aplicado: ${BRL(newPrice)}`);
    } catch (e) {
      toast.error("Erro: " + (e as Error).message);
    } finally {
      setUpdatingIds((prev) => { const s = new Set(prev); s.delete(itemId + "ideal"); return s; });
    }
  }, [params, updateProduct]);

  const exportCSV = () => {
    const header = ["SKU", "Produto", "Tipo", "Preço Atual", "Custo", "Frete", "Full", "ST", "Margem%", "Lucro", "Ideal Premium", "Ideal Clássico", "Cad÷0.75 Premium", "Cad÷0.75 Clássico", "Status"];
    const rows2 = filtered.map(({ product: p, row: r }) => [
      p.sku, p.name, p.listing_type_id || "—",
      r.effectivePrice.toFixed(2), p.cost.toFixed(2),
      r.fixed.fr.toFixed(2), r.fixed.fu.toFixed(2), r.fixed.st.toFixed(2),
      (r.margin * 100).toFixed(1) + "%", r.lucro.toFixed(2),
      r.idealP.toFixed(2), r.idealC.toFixed(2),
      r.cadP.toFixed(2), r.cadC.toFixed(2), r.status,
    ]);
    const csv = [header, ...rows2].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `precificacao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const updateP = (field: keyof Product, sku: string, val: number) => {
    updateProduct(sku, { [field]: val });
    debouncedSave();
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Package />} label="Anúncios ativos" value={stats.total.toString()} />
        <StatCard icon={<TrendingUp />} label="Com custo" value={stats.withCost.toString()} />
        <StatCard icon={<AlertTriangle />} label="Preço baixo" value={stats.low.toString()} tone="danger" />
        <StatCard icon={<CheckCircle2 />} label="Margem ok" value={stats.ok.toString()} tone="success" />
      </div>

      {/* Params */}
      <Card>
        <Collapsible open={paramsOpen} onOpenChange={setParamsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-sm font-semibold">Parâmetros de precificação</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Premium: {tier1Total}% · Clássico: {tier2Total}%
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground border rounded px-2 py-1">⚙ {paramsOpen ? "Fechar" : "Editar"}</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${paramsOpen ? "rotate-180" : ""}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Premium */}
                <TierParamBlock
                  title="ML Premium" tag="gold_pro" tagColor="#2D3277" tagBg="#FFE600"
                  tier={params.tier1}
                  onChange={(t) => setParams({ ...params, tier1: t })}
                  total={tier1Total}
                />
                {/* Clássico */}
                <TierParamBlock
                  title="ML Clássico" tag="12%" tagColor="#2D3277" tagBg="#E8EDFF"
                  tier={params.tier2}
                  onChange={(t) => setParams({ ...params, tier2: t })}
                  total={tier2Total}
                />
                {/* Custos fixos + Margem */}
                <div>
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide pb-2 mb-3 border-b">
                    Custos fixos padrão (R$)
                  </div>
                  <ParamRow label="Frete / Taxa envio" unit="R$">
                    <Input type="number" className="w-20 h-7 text-xs font-mono text-right"
                      value={params.defaultShipping}
                      onChange={(e) => setParams({ ...params, defaultShipping: +e.target.value })} />
                  </ParamRow>
                  <ParamRow label="Armazenagem Full" unit="R$">
                    <Input type="number" className="w-20 h-7 text-xs font-mono text-right"
                      value={params.defaultFull}
                      onChange={(e) => setParams({ ...params, defaultFull: +e.target.value })} />
                  </ParamRow>
                  <ParamRow label="Imposto ST" unit="R$">
                    <Input type="number" className="w-20 h-7 text-xs font-mono text-right"
                      value={params.defaultST}
                      onChange={(e) => setParams({ ...params, defaultST: +e.target.value })} />
                  </ParamRow>
                  <div className="mt-4 border-t pt-3">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
                      Margem mínima global
                    </div>
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-blue-700">🎯 Meta:</span>
                      <Input type="number" min="0" max="99" step="1"
                        className="w-16 h-7 text-xs font-mono text-right bg-white"
                        value={params.targetMargin}
                        onChange={(e) => setParams({ ...params, targetMargin: +e.target.value })} />
                      <span className="text-xs text-blue-600">% — abaixo fica vermelho</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Buscar produto, SKU, ID..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
          <option value="">Todos</option>
          <option value="low">Preço abaixo do ideal</option>
          <option value="ok">Margem adequada</option>
          <option value="nocost">Sem custo</option>
        </select>
        {lastPriceUpdate && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastPriceUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => loadMLProducts(true)} disabled={loadingProducts}>
            {loadingProducts ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            ↻ Carregar ML
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1100 }}>
            <thead>
              <tr className="bg-[#f0f1f7]">
                <th rowSpan={2} className="px-2 py-2 text-left w-9 border-b-2 border-[#2D3277]"></th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277] min-w-[150px]">Produto</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">SKU</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">Preço venda</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">Custo</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">Frete</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-blue-700 border-b-2 border-[#2D3277]">Mg%</th>
                <th colSpan={2} className="px-2 py-1 text-center font-bold text-[#2D3277] bg-[#E8EDFF] border-b-2 border-[#2D3277]">Preço ideal</th>
                <th colSpan={2} className="px-2 py-1 text-center font-bold text-[#8a5c00] bg-[#fef3d0] border-b-2 border-[#8a5c00]">Cadastrar ÷0,75</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">Margem</th>
                <th rowSpan={2} className="px-2 py-2 text-left font-bold text-[#2D3277] border-b-2 border-[#2D3277]">Lucro</th>
                <th rowSpan={2} className="px-2 py-2 border-b-2 border-[#2D3277]"></th>
              </tr>
              <tr className="bg-[#f0f1f7]">
                <th className="px-2 py-1 text-center bg-[#E8EDFF] border-b border-blue-200">
                  <span className="inline-block bg-[#2D3277] text-[#FFE600] text-[9px] font-black px-1.5 py-0.5 rounded">17%</span>
                </th>
                <th className="px-2 py-1 text-center bg-[#E8EDFF] border-b border-blue-200">
                  <span className="inline-block bg-[#E8EDFF] text-[#2D3277] text-[9px] font-black px-1.5 py-0.5 rounded border border-[#c5d8f5]">12%</span>
                </th>
                <th className="px-2 py-1 text-center bg-[#fef3d0] border-b border-yellow-200">
                  <span className="inline-block bg-[#8a5c00] text-white text-[9px] font-black px-1.5 py-0.5 rounded">17%</span>
                </th>
                <th className="px-2 py-1 text-center bg-[#fef3d0] border-b border-yellow-200">
                  <span className="inline-block bg-[#E8EDFF] text-[#2D3277] text-[9px] font-black px-1.5 py-0.5 rounded border border-[#c5d8f5]">12%</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={14} className="px-3 py-12 text-center text-muted-foreground">
                  {loadingProducts
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando produtos do ML...</span>
                    : products.length === 0
                    ? <span>Clique em <strong>↻ Carregar ML</strong> para buscar seus anúncios do Mercado Livre.</span>
                    : <span>Nenhum produto encontrado com os filtros selecionados.</span>}
                </td></tr>
              )}
              {grouped.map(({ sku, items }) => {
                const isGroup = items.length > 1;
                const expanded = expandedSkus.has(sku);
                const toggleGroup = () => setExpandedSkus(prev => {
                  const s = new Set(prev); s.has(sku) ? s.delete(sku) : s.add(sku); return s;
                });
                // linha de grupo (SKU header) quando há mais de 1 anuncio
                const groupHeader = isGroup ? (
                  <tr key={`grp-${sku}`} className="bg-[#E8EDFF]/60 border-t-2 border-[#2D3277]/20 cursor-pointer hover:bg-[#E8EDFF]" onClick={toggleGroup}>
                    <td className="px-2 py-1.5">
                      {expanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-[#2D3277]" />
                        : <ChevronRight className="h-3.5 w-3.5 text-[#2D3277]" />}
                    </td>
                    <td colSpan={13} className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-block bg-[#2D3277] text-[#FFE600] text-[9px] font-black px-1.5 py-0.5 rounded">SKU</span>
                        <span className="font-bold text-[11px] text-[#2D3277]">{sku}</span>
                        <span className="text-[10px] text-muted-foreground">{items.length} anúncios</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{expanded ? "clique para recolher" : "clique para expandir"}</span>
                      </div>
                    </td>
                  </tr>
                ) : null;

                // renderiza items do grupo (ou item único direto)
                const showItems = !isGroup || expanded;

                return [
                  groupHeader,
                  ...(showItems ? items : []).map(({ product: p, row: r }) => {
                const itemId = p.mlItemId || p.sku;
                const isUpdating = updatingIds.has(itemId) || updatingIds.has(itemId + "ideal");
                const used7d = p.mlItemId ? getAccumulated7d(shopId, p.mlItemId) : 0;
                const limitReached = used7d >= 5;
                const mlPrice = p.listings.find((l) => l.channel === "ml")?.currentPrice ?? 0;
                const listingType = p.listing_type_id || "";
                const typeMap: Record<string, [string, string, string]> = {
                  gold_pro: ["PREMIUM", "#2D3277", "#FFE600"],
                  gold_special: ["CLÁSSICO", "#2D3277", "#E8EDFF"],
                  gold: ["OURO", "#8a5c00", "#fff8e1"],
                  silver: ["PRATA", "#555", "#f5f5f5"],
                  free: ["GRÁTIS", "#1a7a45", "#e8f5ee"],
                };
                const typeInfo = typeMap[listingType];
                const showFuST = expandedFuST.has(p.sku);

                return (
                  <tr key={p.sku} className="border-b hover:bg-gray-50 border-gray-100">
                    {/* Foto */}
                    <td className="px-2 py-1.5">
                      <img src={p.image} alt={p.name} className="h-9 w-9 rounded object-cover bg-gray-100"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </td>

                    {/* Produto */}
                    <td className="px-2 py-1.5">
                      <div className="font-medium truncate max-w-[160px]" title={p.name}>{p.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {p.mlItemId && (
                          <a href={`https://produto.mercadolivre.com.br/${p.mlItemId.replace("MLB", "MLB-")}`}
                            target="_blank" rel="noreferrer"
                            className="text-[10px] text-gray-400 font-mono hover:text-blue-600">{p.mlItemId}</a>
                        )}
                        {typeInfo && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ background: typeInfo[2], color: typeInfo[1], border: `1px solid ${typeInfo[1]}20` }}>
                            {typeInfo[0]}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* SKU */}
                    <td className="px-2 py-1.5">
                      {p.sku && p.sku !== p.mlItemId ? (
                        <span className="inline-block bg-[#E8EDFF] text-[#2D3277] border border-[#c5d8f5] rounded px-1.5 py-0.5 text-[10px] font-bold font-mono">
                          {p.sku}
                        </span>
                      ) : <span className="text-gray-300 text-[10px]">—</span>}
                    </td>

                    {/* Preço venda */}
                    <td className="px-2 py-1.5">
                      {(p.promoPrice ?? 0) > 0 ? (
                        <div>
                          <div className="line-through text-gray-400 text-[10px] font-mono">{BRL(mlPrice)}</div>
                          <div className="text-red-600 font-bold font-mono">{BRL(p.promoPrice!)}</div>
                          <span className="text-[9px] bg-red-50 text-red-600 px-1 rounded font-bold">PROMO</span>
                        </div>
                      ) : (() => {
                        const activePromo = p.mlItemId ? activePromos[p.mlItemId] : null;
                        if (activePromo) {
                          return (
                            <div>
                              <div className="line-through text-gray-400 text-[10px] font-mono">{BRL(mlPrice)}</div>
                              <div className="text-green-700 font-bold font-mono">{BRL(activePromo.finalPrice)}</div>
                              <span className="text-[9px] bg-green-50 text-green-700 px-1 rounded font-bold">PROMO ML</span>
                            </div>
                          );
                        }
                        return <span className="font-bold font-mono">{BRL(mlPrice)}</span>;
                      })()}
                      {/* Input promo */}
                      <div className="flex items-center gap-1 mt-1">
                        {(() => {
                          const activePromo = p.mlItemId ? activePromos[p.mlItemId] : null;
                          if (activePromo && !(p.promoPrice ?? 0)) {
                            return (
                              <div className="flex items-center gap-1 flex-1">
                                <Tag className="h-2.5 w-2.5 text-green-600 shrink-0" />
                                <span className="text-[9px] text-green-700 font-bold truncate max-w-[90px]" title={activePromo.name}>
                                  {activePromo.name} -{(activePromo.discountPct * 100).toFixed(0)}%
                                </span>
                              </div>
                            );
                          }
                          return (
                            <>
                              <span className="text-[9px] text-gray-400 font-bold">PROMO</span>
                              <input
                                type="number" min="0" step="0.01" placeholder="—"
                                className="w-16 px-1.5 py-0.5 border rounded text-[10px] font-mono bg-gray-50 outline-none"
                                style={{ borderColor: (p.promoPrice ?? 0) > 0 ? "#f5c6c2" : undefined }}
                                value={p.promoPrice || ""}
                                disabled={p.promoLocked}
                                onChange={(e) => {
                                  updateProduct(p.sku, { promoPrice: e.target.value ? +e.target.value : undefined });
                                  debouncedSave();
                                }}
                              />
                              <button
                                onClick={() => { updateProduct(p.sku, { promoLocked: !p.promoLocked }); debouncedSave(); }}
                                className="text-[10px] px-1 py-0.5 rounded border cursor-pointer"
                                style={{ background: p.promoLocked ? "#c0392b" : "transparent", color: p.promoLocked ? "#fff" : "#c0392b", borderColor: p.promoLocked ? "#c0392b" : "#f5c6c2" }}>
                                {p.promoLocked ? "🔒" : "🔓"}
                              </button>
                            </>
                          );
                        })()}
                      </div>
                      {/* +1% +2% */}
                      <div className="flex items-center gap-1 mt-1">
                        {[1, 2].map((pct) => (
                          <button key={pct}
                            onClick={() => handlePriceIncrease(p, pct)}
                            disabled={limitReached || isUpdating}
                            className="px-1.5 py-0.5 text-[10px] border rounded hover:bg-green-50 hover:text-green-700 hover:border-green-300 disabled:opacity-40 disabled:cursor-not-allowed">
                            +{pct}%
                          </button>
                        ))}
                        {used7d > 0 && (
                          <span className={`text-[9px] ${limitReached ? "text-red-500" : "text-yellow-600"}`}>
                            {limitReached ? "limite" : `${used7d.toFixed(1)}/5%`}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Custo */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" step="0.01" placeholder="0,00"
                          className="w-20 px-1.5 py-1 border rounded text-[11px] font-mono bg-gray-50 outline-none focus:border-blue-400"
                          style={{ borderColor: p.costLocked ? "#FFE600" : p.cost > 0 ? "#b2dfcb" : undefined,
                            background: p.costLocked ? "#fffde7" : p.cost > 0 ? "#f5fbf7" : undefined }}
                          value={p.cost || ""}
                          readOnly={p.costLocked}
                          onChange={(e) => { updateP("cost", p.sku, +e.target.value); }}
                        />
                        <button onClick={() => { updateProduct(p.sku, { costLocked: !p.costLocked }); debouncedSave(); }}
                          className="text-[10px] px-1 py-0.5 rounded border"
                          style={{ background: p.costLocked ? "#FFE600" : "transparent", borderColor: p.costLocked ? "#d4a800" : "#e0e2ee" }}>
                          {p.costLocked ? "🔒" : "🔓"}
                        </button>
                      </div>
                    </td>

                    {/* Frete + Fu/ST */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" step="0.01" placeholder="—"
                          className="w-16 px-1.5 py-1 border rounded text-[11px] font-mono bg-gray-50 outline-none focus:border-blue-400"
                          style={{ borderColor: p.shippingLocked ? "#FFE600" : undefined, background: p.shippingLocked ? "#fffde7" : undefined }}
                          value={p.shipping || ""}
                          readOnly={p.shippingLocked}
                          onChange={(e) => { updateP("shipping", p.sku, +e.target.value); }}
                        />
                        <button onClick={() => { updateProduct(p.sku, { shippingLocked: !p.shippingLocked }); debouncedSave(); }}
                          className="text-[10px] px-1 py-0.5 rounded border"
                          style={{ background: p.shippingLocked ? "#FFE600" : "transparent", borderColor: p.shippingLocked ? "#d4a800" : "#e0e2ee" }}>
                          {p.shippingLocked ? "🔒" : "🔓"}
                        </button>
                      </div>
                      {/* Fu / ST expansível */}
                      <button
                        className="text-[9px] text-gray-400 flex items-center gap-0.5 mt-1 hover:text-gray-600"
                        onClick={() => setExpandedFuST((prev) => { const s = new Set(prev); s.has(p.sku) ? s.delete(p.sku) : s.add(p.sku); return s; })}>
                        {showFuST ? "▾" : "▸"} Fu/ST
                      </button>
                      {showFuST && (
                        <div className="flex flex-col gap-1 mt-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-gray-400 w-4">Fu</span>
                            <input type="number" min="0" step="0.01" placeholder="—"
                              className="w-14 px-1 py-0.5 border rounded text-[10px] font-mono bg-gray-50 outline-none"
                              value={p.fullCost || ""}
                              onChange={(e) => { updateP("fullCost", p.sku, +e.target.value); }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-gray-400 w-4">ST</span>
                            <input type="number" min="0" step="0.01" placeholder="—"
                              className="w-14 px-1 py-0.5 border rounded text-[10px] font-mono bg-gray-50 outline-none"
                              value={p.stCost || ""}
                              onChange={(e) => { updateP("stCost", p.sku, +e.target.value); }} />
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Mg% */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" max="99" step="0.5"
                          className="w-12 px-1.5 py-1 border rounded text-[11px] font-mono text-right outline-none"
                          style={{ borderColor: "#c5d8f5", background: p.marginLocked ? "#185FA5" : "#e8f0fb", color: p.marginLocked ? "#fff" : "#0c447c", cursor: p.marginLocked ? "not-allowed" : "text" }}
                          placeholder={String(params.targetMargin)}
                          value={p.marginTarget || ""}
                          readOnly={p.marginLocked}
                          onChange={(e) => { updateP("marginTarget", p.sku, +e.target.value); }}
                          title="Margem mínima deste produto (sobrepõe global)"
                        />
                        <button onClick={() => { updateProduct(p.sku, { marginLocked: !p.marginLocked }); debouncedSave(); }}
                          className="text-[10px] px-1 py-0.5 rounded border"
                          style={{ background: p.marginLocked ? "#185FA5" : "transparent", borderColor: "#c5d8f5", color: p.marginLocked ? "#fff" : "#185FA5" }}>
                          {p.marginLocked ? "🔒" : "🔓"}
                        </button>
                      </div>
                    </td>

                    {/* Ideal Premium */}
                    <td className="px-2 py-1.5 bg-[#E8EDFF]/30">
                      <span className="font-bold font-mono text-[#2D3277]">{r.idealP > 0 ? BRL(r.idealP) : "—"}</span>
                      {r.idealP > 0 && (
                        <button onClick={() => handleSetIdealPrice(p, 1)}
                          className="block text-[9px] mt-0.5 text-blue-600 hover:underline">
                          aplicar ↗
                        </button>
                      )}
                    </td>

                    {/* Ideal Clássico */}
                    <td className="px-2 py-1.5 bg-[#E8EDFF]/30">
                      <span className="font-bold font-mono text-[#1a5fa8]">{r.idealC > 0 ? BRL(r.idealC) : "—"}</span>
                      {r.idealC > 0 && (
                        <button onClick={() => handleSetIdealPrice(p, 2)}
                          className="block text-[9px] mt-0.5 text-blue-600 hover:underline">
                          aplicar ↗
                        </button>
                      )}
                    </td>

                    {/* Cad ÷0.75 Premium */}
                    <td className="px-2 py-1.5 bg-[#fef3d0]/40">
                      <span className="font-bold font-mono text-[#8a5c00]">{r.cadP > 0 ? BRL(r.cadP) : "—"}</span>
                    </td>

                    {/* Cad ÷0.75 Clássico */}
                    <td className="px-2 py-1.5 bg-[#fef3d0]/40">
                      <span className="font-bold font-mono text-[#8a5c00]">{r.cadC > 0 ? BRL(r.cadC) : "—"}</span>
                    </td>

                    {/* Margem badge */}
                    <td className="px-2 py-1.5">
                      {r.status === "nocost" ? (
                        <span className="text-gray-400 text-[10px]">—</span>
                      ) : (
                        <MarginBadge margin={r.margin} target={r.marginTarget} />
                      )}
                    </td>

                    {/* Lucro */}
                    <td className="px-2 py-1.5">
                      {r.status === "nocost" ? (
                        <span className="text-gray-400 text-[10px]">—</span>
                      ) : (
                        <div>
                          <span className={`font-mono font-semibold text-[11px] ${r.lucro >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {r.lucro >= 0 ? "+" : ""}{BRL(r.lucro)}
                          </span>
                          <span className="text-[10px] text-gray-400 ml-1">
                            {r.lucro >= 0 ? "+" : ""}{(r.lucro / (r.effectivePrice || 1) * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Ver link */}
                    <td className="px-2 py-1.5">
                      {p.mlItemId && (
                        <a href={`https://produto.mercadolivre.com.br/${p.mlItemId.replace("MLB", "MLB-")}`}
                          target="_blank" rel="noreferrer"
                          className="text-[10px] text-blue-500 hover:underline">Ver ↗</a>
                      )}
                    </td>
                  </tr>
                );
              }), // fim items do grupo
                ]; // fim return do grupo
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function TierParamBlock({ title, tag, tagColor, tagBg, tier, onChange, total }: {
  title: string; tag: string; tagColor: string; tagBg: string;
  tier: { commission: number; ads: number; returns: number; packaging: number; tax: number };
  onChange: (t: typeof tier) => void;
  total: string;
}) {
  const f = (field: keyof typeof tier) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...tier, [field]: +e.target.value });

  return (
    <div>
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide pb-2 mb-3 border-b flex items-center gap-2">
        {title}
        <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
          style={{ background: tagBg, color: tagColor, border: `1px solid ${tagColor}30` }}>{tag}</span>
      </div>
      {[
        ["Comissão ML", "commission"],
        ["Anúncios (Ads)", "ads"],
        ["Devolução", "returns"],
        ["Embalagem", "packaging"],
        ["Imposto (NF)", "tax"],
      ].map(([label, field]) => (
        <div key={field} className="flex items-center justify-between py-1 text-xs">
          <span className="text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1">
            <Input type="number" className="w-16 h-6 text-xs font-mono text-right"
              value={tier[field as keyof typeof tier]}
              onChange={f(field as keyof typeof tier)} />
            <span className="text-muted-foreground">%</span>
          </div>
        </div>
      ))}
      <div className="mt-2 px-2 py-1.5 bg-gray-100 rounded flex justify-between text-xs font-bold">
        <span>Total deduções</span>
        <span>{total}%</span>
      </div>
    </div>
  );
}

function ParamRow({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">{unit}</span>
        {children}
      </div>
    </div>
  );
}

function MarginBadge({ margin, target }: { margin: number; target: number }) {
  const pct = (margin * 100).toFixed(1) + "%";
  if (margin >= target) return <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-green-100 text-green-700">{pct}</span>;
  if (margin >= target / 2) return <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-yellow-100 text-yellow-700">{pct}</span>;
  return <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700">{pct}</span>;
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "success" | "danger" }) {
  const cls = tone === "success" ? "bg-green-500/10 text-green-600" : tone === "danger" ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cls}`}>{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
