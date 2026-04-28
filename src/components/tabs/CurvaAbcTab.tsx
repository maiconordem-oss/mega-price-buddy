import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ml, serverSave, serverLoad, toMLDate, chunks, fetchAllOrders, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useShopReset } from "@/hooks/useShopReset";
import { toast } from "sonner";
import { Loader2, RefreshCw, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface AbcItem {
  sku: string; name: string; mlItemId: string; image: string;
  revenue: number; qty: number; visits: number;
  revenueShare: number; cumulativeShare: number;
  abc: "A" | "B" | "C";
}

const CACHE_KEY   = "curva-abc";
const CACHE_TTL   = 120;
const AUTO_MS     = 20 * 60 * 1000; // 20 min
const ABC_COLORS  = { A: "#1a7a45", B: "#8a5c00", C: "#c0392b" };

export function CurvaAbcTab() {
  const { products } = useProducts();
  const { userId }   = useAuth();
  const [data, setData]       = useState<AbcItem[]>([]);
  const [loaded, setLoaded]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays]       = useState(30);
  const [mode, setMode]       = useState<"revenue"|"qty"|"visits">("revenue");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useShopReset(useCallback(() => {
    setData([]); setLoaded(false); setLastUpdate(null);
  }, []));
  const loadingRef = useRef(false);

  const load = useCallback(async (force = false) => {
    if (!products.length || !userId) return;
    if (loadingRef.current) return;

    if (!force) {
      try {
        const cached = await serverLoad<AbcItem[]>(CACHE_KEY);
        if (cached?.data && cached?.ts) {
          const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
          if (age < CACHE_TTL) {
            setData(cached.data); setLoaded(true);
            setLastUpdate(new Date(cached.ts)); return;
          }
        }
      } catch {}
    }

    loadingRef.current = true;
    setLoading(true);
    try {
      const now      = new Date();
      const from     = new Date(now.getTime() - days * 86400000);
      const dateFrom = toMLDate(from);
      const dateTo   = toMLDate(now);

      const mlItems = products.filter(p => p.mlItemId);
      const itemIds = mlItems.map(p => p.mlItemId!);

      // visitas: API aceita apenas 1 item por request — paralelo em lotes de 10
      const visitMap: Record<string, number> = {}
      for (const batch of chunks(itemIds, 10)) {
        await Promise.all(batch.map(async id => {
          try {
            const vRes = await ml(
              `/visits/items?ids=${id}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
            ) as Record<string, { total_visits: number }>
            visitMap[id] = vRes[id]?.total_visits || 0
          } catch {
            visitMap[id] = 0
          }
        }))
        await new Promise(r => setTimeout(r, 200))
      }

      // pedidos com paginacao completa
      type OrderItem = { item: { id: string }; quantity: number; unit_price: number }
      type RawOrder  = { order_items: OrderItem[] }
      const allOrders = await fetchAllOrders(userId, "paid", dateFrom) as RawOrder[]

      const soldMap: Record<string, { qty: number; revenue: number }> = {}
      for (const order of allOrders) {
        for (const oi of order.order_items || []) {
          const rawId = oi.item?.id; if (!rawId) continue
          const id = String(rawId).startsWith("MLB") ? String(rawId) : `MLB${rawId}`
          soldMap[id] = soldMap[id] || { qty: 0, revenue: 0 }
          soldMap[id].qty     += Number(oi.quantity) || 0
          soldMap[id].revenue += (Number(oi.quantity) || 0) * (Number(oi.unit_price) || 0)
        }
      }

      // classificacao ABC por faturamento
      const raw = mlItems.map(p => ({
        sku: p.sku, name: p.name, mlItemId: p.mlItemId!, image: p.image,
        revenue: soldMap[p.mlItemId!]?.revenue || 0,
        qty:     soldMap[p.mlItemId!]?.qty || 0,
        visits:  visitMap[p.mlItemId!] || 0,
      })).sort((a, b) => b.revenue - a.revenue);

      const totalRevenue = raw.reduce((s, r) => s + r.revenue, 0);
      let cum = 0;
      const classified: AbcItem[] = raw.map(r => {
        cum += r.revenue;
        const share           = totalRevenue > 0 ? (r.revenue / totalRevenue) * 100 : 0;
        const cumulativeShare = totalRevenue > 0 ? (cum / totalRevenue) * 100 : 0;
        const abc: "A"|"B"|"C" = cumulativeShare <= 70 ? "A" : cumulativeShare <= 90 ? "B" : "C";
        return { ...r, revenueShare: share, cumulativeShare, abc };
      });

      setData(classified); setLoaded(true); setLastUpdate(new Date());
      serverSave(CACHE_KEY, classified).catch(() => {});
      if (force) toast.success(`ABC calculada · ${allOrders.length} pedidos · ${classified.length} produtos`);
    } catch (e) {
      if (force) toast.error("Erro: " + (e as Error).message);
    } finally {
      setLoading(false); loadingRef.current = false;
    }
  }, [products, userId, days]);

  useAutoRefresh(() => load(false), AUTO_MS, !!userId && !!products.length);

  const counts = useMemo(() => ({
    A: data.filter(d => d.abc === "A").length,
    B: data.filter(d => d.abc === "B").length,
    C: data.filter(d => d.abc === "C").length,
  }), [data]);

  const chartData = data.slice(0, 20).map(d => ({
    name: d.name.slice(0, 18) + (d.name.length > 18 ? "…" : ""),
    value: mode === "revenue" ? d.revenue : mode === "qty" ? d.qty : d.visits,
    abc: d.abc,
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {(["A","B","C"] as const).map(l => (
          <Card key={l}><CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-black text-xl"
              style={{ background: ABC_COLORS[l] }}>{l}</div>
            <div>
              <div className="text-xs text-muted-foreground">
                {l === "A" ? "Campeões (até 70%)" : l === "B" ? "Intermediários (70–90%)" : "Baixo giro (90–100%)"}
              </div>
              <div className="text-2xl font-bold">{counts[l]} produtos</div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={e => { setDays(+e.target.value); setLoaded(false); }}>
          <option value={30}>30 dias</option>
          <option value={60}>60 dias</option>
          <option value={90}>90 dias</option>
        </select>
        {(["revenue","qty","visits"] as const).map(m => (
          <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
            {m === "revenue" ? "Faturamento" : m === "qty" ? "Quantidade" : "Visitas"}
          </Button>
        ))}
        {lastUpdate && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Calcular"}
        </Button>
      </div>

      {loaded && chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top 20 — {mode === "revenue" ? "Faturamento" : mode === "qty" ? "Qtd Vendida" : "Visitas"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ left: 10, right: 10, bottom: 60 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => mode === "revenue" ? BRL(v) : v.toLocaleString("pt-BR")} />
                <Bar dataKey="value" radius={[4,4,0,0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={ABC_COLORS[entry.abc as "A"|"B"|"C"]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Classe","Foto","Produto","Faturamento","% Fat.","% Acum.","Qtd","Visitas"].map(h => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  Clique em <strong>Calcular</strong>.
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="px-3 py-10 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  <div className="text-xs text-muted-foreground mt-2">Buscando todos os pedidos para classificação...</div>
                </td></tr>
              )}
              {!loading && data.map(item => (
                <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Badge style={{ background: ABC_COLORS[item.abc] + "25", color: ABC_COLORS[item.abc], border: 0 }}>
                      {item.abc}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <img src={item.image} className="h-9 w-9 rounded object-cover bg-muted" alt=""
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
