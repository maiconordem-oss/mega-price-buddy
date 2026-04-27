import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ml, serverSave, serverLoad, toMLDate, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface AbcItem {
  sku: string;
  name: string;
  mlItemId: string;
  image: string;
  revenue: number;
  qty: number;
  visits: number;
  revenueShare: number;
  cumulativeShare: number;
  abc: "A" | "B" | "C";
}

const CACHE_KEY = "curva-abc";
const CACHE_TTL = 120;

const ABC_COLORS = { A: "#1a7a45", B: "#8a5c00", C: "#c0392b" };

export function CurvaAbcTab() {
  const { products } = useProducts();
  const { userId } = useAuth();
  const [data, setData] = useState<AbcItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<"revenue" | "qty" | "visits">("revenue");

  const load = useCallback(
    async (force = false) => {
      if (!products.length) { toast.info("Carregue os produtos primeiro."); return; }
      if (!userId) { toast.info("Conecte o Mercado Livre."); return; }
      if (!force && loaded) return;

      if (!force) {
        try {
          const cached = await serverLoad<AbcItem[]>(CACHE_KEY);
          if (cached?.data && cached?.ts) {
            const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
            if (age < CACHE_TTL) { setData(cached.data); setLoaded(true); return; }
          }
        } catch {}
      }

      setLoading(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - days * 86400000);
        const dateFrom = encodeURIComponent(toMLDate(from));
        const dateTo = encodeURIComponent(toMLDate(now));

        const mlItems = products.filter((p) => p.mlItemId);
        const itemIds = mlItems.map((p) => p.mlItemId!);

        // Visitas
        const visitMap: Record<string, number> = {};
        const vBatches = [];
        for (let i = 0; i < itemIds.length; i += 50) vBatches.push(itemIds.slice(i, i + 50));
        for (const batch of vBatches) {
          const vRes = await ml(
            `/visits/items?ids=${batch.join(",")}&date_from=${dateFrom}&date_to=${dateTo}`,
          ) as Record<string, { total_visits: number }>;
          for (const [id, v] of Object.entries(vRes)) visitMap[id] = (visitMap[id] || 0) + (v?.total_visits || 0);
        }

        // Pedidos
        const soldMap: Record<string, { qty: number; revenue: number }> = {};
        const orderRes = await ml(
          `/orders/search?seller=${userId}&order.status=paid&sort=date_desc&limit=50&date_created_from=${dateFrom}`,
        ) as { results: Array<{ order_items: Array<{ item: { id: string }; quantity: number; unit_price: number }> }> };
        for (const order of orderRes.results || []) {
          for (const oi of order.order_items || []) {
            const id = oi.item?.id;
            if (!id) continue;
            soldMap[id] = soldMap[id] || { qty: 0, revenue: 0 };
            soldMap[id].qty += oi.quantity;
            soldMap[id].revenue += oi.quantity * oi.unit_price;
          }
        }

        // Classificação ABC por faturamento
        const raw = mlItems.map((p) => ({
          sku: p.sku, name: p.name, mlItemId: p.mlItemId!, image: p.image,
          revenue: soldMap[p.mlItemId!]?.revenue || 0,
          qty: soldMap[p.mlItemId!]?.qty || 0,
          visits: visitMap[p.mlItemId!] || 0,
        })).sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = raw.reduce((s, r) => s + r.revenue, 0);
        let cum = 0;
        const classified: AbcItem[] = raw.map((r) => {
          cum += r.revenue;
          const share = totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0;
          const cumulativeShare = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
          const abc: "A" | "B" | "C" = cumulativeShare <= 70 ? "A" : cumulativeShare <= 90 ? "B" : "C";
          return { ...r, revenueShare: share, cumulativeShare, abc };
        });

        setData(classified);
        setLoaded(true);
        serverSave(CACHE_KEY, classified).catch(() => {});
        toast.success("Curva ABC calculada");
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [products, userId, days, loaded],
  );

  const counts = useMemo(() => ({
    A: data.filter((d) => d.abc === "A").length,
    B: data.filter((d) => d.abc === "B").length,
    C: data.filter((d) => d.abc === "C").length,
  }), [data]);

  const chartData = data.slice(0, 20).map((d) => ({
    name: d.name.slice(0, 18) + (d.name.length > 18 ? "…" : ""),
    value: mode === "revenue" ? d.revenue : mode === "qty" ? d.qty : d.visits,
    abc: d.abc,
  }));

  return (
    <div className="space-y-5">
      {/* ABC summary */}
      <div className="grid grid-cols-3 gap-4">
        {(["A", "B", "C"] as const).map((l) => (
          <Card key={l}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center text-white font-black text-xl`}
                style={{ background: ABC_COLORS[l] }}>
                {l}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {l === "A" ? "Campeões (até 70%)" : l === "B" ? "Intermediários (70–90%)" : "Baixo giro (90–100%)"}
                </div>
                <div className="text-2xl font-bold">{counts[l]} produtos</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={(e) => { setDays(+e.target.value); setLoaded(false); }}>
          <option value={30}>30 dias</option>
          <option value={60}>60 dias</option>
          <option value={90}>90 dias</option>
        </select>
        {(["revenue", "qty", "visits"] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
            {m === "revenue" ? "Faturamento" : m === "qty" ? "Quantidade" : "Visitas"}
          </Button>
        ))}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Calcular"}
        </Button>
      </div>

      {/* Chart */}
      {loaded && chartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Top 20 Produtos — {mode === "revenue" ? "Faturamento" : mode === "qty" ? "Qtd Vendida" : "Visitas"}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ left: 10, right: 10, bottom: 60 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => mode === "revenue" ? BRL(v) : v.toLocaleString("pt-BR")} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={ABC_COLORS[entry.abc as "A" | "B" | "C"]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Classe", "Foto", "Produto", "Faturamento", "% Fat.", "% Acum.", "Qtd", "Visitas"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">Clique em Calcular.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              )}
              {data.map((item) => (
                <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Badge style={{ background: ABC_COLORS[item.abc] + "25", color: ABC_COLORS[item.abc], border: 0 }}>
                      {item.abc}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <img src={item.image} className="h-9 w-9 rounded object-cover bg-muted" alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-[180px]">
                    <div className="truncate" title={item.name}>{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.sku}</div>
                  </td>
                  <td className="px-3 py-2 font-semibold">{BRL(item.revenue)}</td>
                  <td className="px-3 py-2">{item.revenueShare.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{item.cumulativeShare.toFixed(1)}%</td>
                  <td className="px-3 py-2 font-mono">{item.qty}</td>
                  <td className="px-3 py-2 font-mono">{item.visits.toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
