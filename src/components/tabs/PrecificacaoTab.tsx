import { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Package, TrendingUp, CheckCircle2, AlertTriangle, Loader2, Download, Search } from "lucide-react";
import { useProducts } from "@/contexts/ProductsContext";
import { CHANNELS, type Channel } from "@/types/marketplace";
import { useMarketplace } from "@/hooks/useMarketplace";
import { updatePrice } from "@/services/mercadolivre";
import { BRL } from "@/services/ml-api";
import { toast } from "sonner";

function computeRow(
  product: ReturnType<typeof useMarketplace>[number],
  params: ReturnType<typeof useProducts>["params"],
  channel: Channel,
) {
  const listing = product.listings.find((l) => l.channel === channel) ?? product.listings[0];
  const fee = params.fees[listing.channel];
  const totalCost = product.cost + product.shipping + params.packaging;
  const denom = 1 - params.targetMargin / 100 - fee / 100 - params.tax / 100;
  const suggested = denom > 0 ? totalCost / denom : totalCost * 2;
  const current = listing.currentPrice;
  const diff = current - suggested;
  const realMargin =
    ((current - totalCost - (current * (fee + params.tax)) / 100) / current) * 100;

  let status: "lucro" | "atencao" | "prejuizo" = "lucro";
  if (realMargin < 0) status = "prejuizo";
  else if (realMargin < params.targetMargin - 5) status = "atencao";

  return { listing, suggested, current, diff, realMargin, status };
}

export function PrecificacaoTab() {
  const { params, setParams, products, updateProduct, loadMLProducts, loadingProducts } = useProducts();
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [paramsOpen, setParamsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const filtered = useMarketplace(channel);

  const searched = useMemo(() => {
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [filtered, search]);

  const displayChannel: Channel = channel === "all" ? "ml" : channel;

  const stats = useMemo(() => {
    let lucro = 0, prejuizo = 0, atencao = 0;
    const margens: number[] = [];
    for (const p of products) {
      for (const l of p.listings) {
        const r = computeRow({ ...p, listings: [l] }, params, l.channel);
        margens.push(r.realMargin);
        if (r.status === "prejuizo") prejuizo++;
        else if (r.status === "atencao") atencao++;
        else lucro++;
      }
    }
    const avg = margens.length ? margens.reduce((a, b) => a + b, 0) / margens.length : 0;
    return { total: products.length, avg, lucro, prejuizo, atencao };
  }, [products, params]);

  const handleUpdatePrice = useCallback(
    async (product: ReturnType<typeof useMarketplace>[number], ch: Channel) => {
      const itemId = product.mlItemId;
      if (!itemId) {
        toast.error("ID do anúncio ML não disponível. Carregue os produtos reais.");
        return;
      }
      const r = computeRow(product, params, ch);
      const key = itemId;
      setUpdatingIds((prev) => new Set(prev).add(key));
      try {
        await updatePrice(itemId, parseFloat(r.suggested.toFixed(2)));
        updateProduct(product.sku, {
          listings: product.listings.map((l) =>
            l.channel === ch ? { ...l, currentPrice: parseFloat(r.suggested.toFixed(2)) } : l,
          ),
        });
        toast.success(`Preço atualizado para ${BRL(r.suggested)}`);
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setUpdatingIds((prev) => {
          const s = new Set(prev);
          s.delete(key);
          return s;
        });
      }
    },
    [params, updateProduct],
  );

  const exportCSV = () => {
    const rows = [
      ["SKU", "Produto", "Canal", "Custo", "Frete", "Margem%", "Preço Sugerido", "Preço Atual", "Diff", "Status"],
      ...searched.map((p) => {
        const ch = channel === "all" ? p.listings[0].channel : displayChannel;
        const r = computeRow(p, params, ch);
        return [
          p.sku, p.name, ch,
          p.cost.toFixed(2), p.shipping.toFixed(2),
          r.realMargin.toFixed(1) + "%",
          r.suggested.toFixed(2), r.current.toFixed(2),
          r.diff.toFixed(2), r.status,
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `precificacao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Package />} label="Total Produtos" value={stats.total.toString()} />
        <StatCard icon={<TrendingUp />} label="Margem Média" value={`${stats.avg.toFixed(1)}%`} />
        <StatCard icon={<CheckCircle2 />} label="Com Lucro" value={stats.lucro.toString()} tone="success" />
        <StatCard icon={<AlertTriangle />} label="Atenção / Prejuízo" value={`${stats.atencao} / ${stats.prejuizo}`} tone="danger" />
      </div>

      {/* Params */}
      <Card>
        <Collapsible open={paramsOpen} onOpenChange={setParamsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Parâmetros de Precificação</CardTitle>
              <ChevronDown className={`h-5 w-5 transition-transform ${paramsOpen ? "rotate-180" : ""}`} />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 pt-0">
              {CHANNELS.map((c) => (
                <div key={c.id} className="space-y-1.5">
                  <Label className="text-xs">Taxa {c.short} (%)</Label>
                  <Input
                    type="number"
                    value={params.fees[c.id]}
                    onChange={(e) =>
                      setParams({ ...params, fees: { ...params.fees, [c.id]: +e.target.value } })
                    }
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label className="text-xs">Imposto (%)</Label>
                <Input type="number" value={params.tax}
                  onChange={(e) => setParams({ ...params, tax: +e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Embalagem (R$)</Label>
                <Input type="number" value={params.packaging}
                  onChange={(e) => setParams({ ...params, packaging: +e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Margem alvo (%)</Label>
                <Input type="number" value={params.targetMargin}
                  onChange={(e) => setParams({ ...params, targetMargin: +e.target.value })} />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar produto ou SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {(["all", ...CHANNELS.map((c) => c.id)] as const).map((c) => (
            <Button key={c} size="sm" variant={channel === c ? "default" : "outline"}
              onClick={() => setChannel(c)}>
              {c === "all" ? "Todos" : CHANNELS.find((x) => x.id === c)?.short}
            </Button>
          ))}
        </div>

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
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Foto", "Produto", "SKU", "Custo (R$)", "Frete (R$)", "Margem%", "Sugerido", "Atual", "Diff", "Status", "Ação"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {searched.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                    {loadingProducts ? "Carregando produtos..." : "Nenhum produto encontrado."}
                  </td>
                </tr>
              )}
              {searched.map((p) => {
                const ch = channel === "all" ? p.listings[0].channel : displayChannel;
                const r = computeRow(p, params, ch);
                const itemId = p.mlItemId || p.sku;
                const isUpdating = updatingIds.has(itemId);
                return (
                  <tr key={p.sku + ch} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <img src={p.image} alt={p.name}
                        className="h-10 w-10 rounded-md object-cover bg-muted"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium max-w-[200px]">
                      <div className="truncate" title={p.name}>{p.name}</div>
                      {p.mlItemId && (
                        <a href={`https://www.mercadolivre.com.br/anuncio/${p.mlItemId}`}
                          target="_blank" rel="noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary">
                          {p.mlItemId}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{p.sku}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="w-20 h-7 text-xs"
                        value={p.cost}
                        onChange={(e) => updateProduct(p.sku, { cost: +e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        className="w-20 h-7 text-xs"
                        value={p.shipping}
                        onChange={(e) => updateProduct(p.sku, { shipping: +e.target.value })}
                      />
                    </td>
                    <td className={`px-3 py-2 font-medium ${r.realMargin < 0 ? "text-destructive" : r.realMargin < params.targetMargin - 5 ? "text-yellow-600" : "text-green-600"}`}>
                      {r.realMargin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 font-semibold">{BRL(r.suggested)}</td>
                    <td className="px-3 py-2">{BRL(r.current)}</td>
                    <td className={`px-3 py-2 font-medium ${r.diff < 0 ? "text-destructive" : "text-green-600"}`}>
                      {r.diff >= 0 ? "+" : ""}{BRL(r.diff)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant={r.diff < -0.5 ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => handleUpdatePrice(p, ch)}
                        disabled={isUpdating}
                      >
                        {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Atualizar"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone?: "success" | "danger";
}) {
  const cls = tone === "success" ? "bg-green-500/10 text-green-600"
    : tone === "danger" ? "bg-red-500/10 text-red-600"
    : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${cls}`}>{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: "lucro" | "atencao" | "prejuizo" }) {
  if (status === "lucro")
    return <Badge className="bg-green-500/15 text-green-700 border-0 hover:bg-green-500/20">Com lucro</Badge>;
  if (status === "atencao")
    return <Badge className="bg-yellow-400/20 text-yellow-700 border-0 hover:bg-yellow-400/30">Atenção</Badge>;
  return <Badge className="bg-red-500/15 text-red-700 border-0 hover:bg-red-500/20">Prejuízo</Badge>;
}
