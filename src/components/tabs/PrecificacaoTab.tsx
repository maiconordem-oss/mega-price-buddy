import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Package, TrendingUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { useProducts } from "@/contexts/ProductsContext";
import { CHANNELS, type Channel } from "@/types/marketplace";
import { useMarketplace } from "@/hooks/useMarketplace";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function computeRow(
  product: ReturnType<typeof useMarketplace>[number],
  params: ReturnType<typeof useProducts>["params"],
  channel: Channel,
) {
  const listing = product.listings.find((l) => l.channel === channel) ?? product.listings[0];
  const fee = params.fees[listing.channel];
  const totalCost = product.cost + product.shipping + params.packaging;
  // Suggested: cost / (1 - margin% - fee% - tax%)
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
  const { params, setParams, products } = useProducts();
  const [channel, setChannel] = useState<Channel | "all">("all");
  const [paramsOpen, setParamsOpen] = useState(false);

  const filtered = useMarketplace(channel);
  const displayChannel: Channel = channel === "all" ? "ml" : channel;

  const stats = useMemo(() => {
    let lucro = 0,
      prejuizo = 0,
      margens: number[] = [];
    for (const p of products) {
      for (const l of p.listings) {
        const r = computeRow({ ...p, listings: [l] }, params, l.channel);
        margens.push(r.realMargin);
        if (r.status === "prejuizo") prejuizo++;
        else lucro++;
      }
    }
    const avg = margens.length ? margens.reduce((a, b) => a + b, 0) / margens.length : 0;
    return { total: products.length, avg, lucro, prejuizo };
  }, [products, params]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Package />} label="Total Produtos" value={stats.total.toString()} />
        <StatCard icon={<TrendingUp />} label="Margem Média" value={`${stats.avg.toFixed(1)}%`} />
        <StatCard
          icon={<CheckCircle2 />}
          label="Com Lucro"
          value={stats.lucro.toString()}
          tone="success"
        />
        <StatCard
          icon={<AlertTriangle />}
          label="No Prejuízo"
          value={stats.prejuizo.toString()}
          tone="danger"
        />
      </div>

      <Card>
        <Collapsible open={paramsOpen} onOpenChange={setParamsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex-row items-center justify-between">
              <CardTitle className="text-base">Parâmetros de Precificação</CardTitle>
              <ChevronDown
                className={`h-5 w-5 transition-transform ${paramsOpen ? "rotate-180" : ""}`}
              />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
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
                <Input
                  type="number"
                  value={params.tax}
                  onChange={(e) => setParams({ ...params, tax: +e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Embalagem (R$)</Label>
                <Input
                  type="number"
                  value={params.packaging}
                  onChange={(e) => setParams({ ...params, packaging: +e.target.value })}
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["all", ...CHANNELS.map((c) => c.id)] as const).map((c) => (
          <Button
            key={c}
            size="sm"
            variant={channel === c ? "default" : "outline"}
            onClick={() => setChannel(c)}
          >
            {c === "all" ? "Todos" : CHANNELS.find((x) => x.id === c)?.short}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {[
                  "Foto",
                  "Produto",
                  "SKU",
                  "Custo",
                  "Frete",
                  "Margem%",
                  "Preço Sugerido",
                  "Preço Atual",
                  "Diff",
                  "Status",
                  "Ação",
                ].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const ch = channel === "all" ? p.listings[0].channel : displayChannel;
                const r = computeRow(p, params, ch);
                return (
                  <tr key={p.sku + ch} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <img src={p.image} alt={p.name} className="h-10 w-10 rounded-md" />
                    </td>
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.sku}</td>
                    <td className="px-3 py-2.5">{fmt(p.cost)}</td>
                    <td className="px-3 py-2.5">{fmt(p.shipping)}</td>
                    <td className="px-3 py-2.5">{r.realMargin.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 font-medium">{fmt(r.suggested)}</td>
                    <td className="px-3 py-2.5">{fmt(r.current)}</td>
                    <td
                      className={`px-3 py-2.5 font-medium ${r.diff < 0 ? "text-danger" : "text-success"}`}
                    >
                      {r.diff >= 0 ? "+" : ""}
                      {fmt(r.diff)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Button size="sm" variant="outline">
                        Atualizar
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

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "danger"
        ? "bg-danger/10 text-danger"
        : "bg-primary/10 text-primary";
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${toneCls}`}>
          {icon}
        </div>
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
    return <Badge className="bg-success/15 text-success hover:bg-success/20 border-0">Com lucro</Badge>;
  if (status === "atencao")
    return <Badge className="bg-warning/20 text-warning-foreground hover:bg-warning/30 border-0" style={{ color: "oklch(0.4 0.12 75)" }}>Atenção</Badge>;
  return <Badge className="bg-danger/15 text-danger hover:bg-danger/20 border-0">Prejuízo</Badge>;
}
