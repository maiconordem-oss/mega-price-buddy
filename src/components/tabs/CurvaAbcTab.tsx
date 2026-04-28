import { useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BRL } from "@/services/ml-api"
import { useProducts } from "@/contexts/ProductsContext"
import { useAnalytics, filterOrdersByDays, buildOrderMap } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { Loader2, RefreshCw, Clock } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"

interface AbcItem {
  sku: string; name: string; mlItemId: string; image: string
  revenue: number; qty: number; visits: number; abc: "A" | "B" | "C"
}

const ABC_COLORS = { A: "#1a7a45", B: "#8a5c00", C: "#c0392b" }
const CACHE_KEY  = "curva-abc"

export function CurvaAbcTab() {
  const { products } = useProducts()
  const { visitMap, allOrders, loading, loaded, lastFetch, load } = useAnalytics()
  const [days, setDays] = useState(30)
  const [mode, setMode] = useState<"revenue"|"qty"|"visits">("revenue")

  useShopReset(useCallback(() => { setDays(30) }, []))

  // Filtra pelo período selecionado
  const filteredOrders = useMemo(() => filterOrdersByDays(allOrders, days), [allOrders, days])
  const orderMap       = useMemo(() => buildOrderMap(filteredOrders), [filteredOrders])

  // Classificação ABC
  const classified = useMemo((): AbcItem[] => {
    const mlItems = products.filter(p => p.mlItemId)
    const raw = mlItems.map(p => ({
      sku: p.sku, name: p.name, mlItemId: p.mlItemId!, image: p.image,
      revenue: orderMap[p.mlItemId!]?.revenue || 0,
      qty:     orderMap[p.mlItemId!]?.qty || 0,
      visits:  visitMap[p.mlItemId!] || 0,
    })).sort((a, b) => b.revenue - a.revenue)

    const totalRev = raw.reduce((s, r) => s + r.revenue, 0)
    let acc = 0
    return raw.map(r => {
      acc += r.revenue
      const pct = totalRev > 0 ? acc / totalRev : 1
      return { ...r, abc: pct <= 0.70 ? "A" : pct <= 0.90 ? "B" : "C" } as AbcItem
    })
  }, [products, orderMap, visitMap])

  const chartData = useMemo(() =>
    classified.slice(0, 20).map(d => ({
      name:  d.name.length > 20 ? d.name.slice(0, 20) + "…" : d.name,
      value: mode === "revenue" ? d.revenue : mode === "qty" ? d.qty : d.visits,
      abc:   d.abc,
    })), [classified, mode])

  const counts = { A: classified.filter(x => x.abc === "A").length, B: classified.filter(x => x.abc === "B").length, C: classified.filter(x => x.abc === "C").length }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {(["A","B","C"] as const).map(l => (
          <Card key={l}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-11 w-11 rounded-xl flex items-center justify-center font-black text-lg text-white"
                style={{ background: ABC_COLORS[l] }}>{l}</div>
              <div>
                <div className="text-xs text-muted-foreground">{l === "A" ? "Top 70% receita" : l === "B" ? "70–90% receita" : "Cauda longa"}</div>
                <div className="text-2xl font-bold">{counts[l]} produtos</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={e => setDays(+e.target.value)}>
          {[7,30,60,90].map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
        </select>
        <div className="flex rounded-md border overflow-hidden">
          {(["revenue","qty","visits"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {m === "revenue" ? "Faturamento" : m === "qty" ? "Quantidade" : "Visitas"}
            </button>
          ))}
        </div>
        {lastFetch && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastFetch.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Calcular"}
        </Button>
      </div>

      {/* Gráfico */}
      {loaded && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top 20 produtos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 60 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => mode === "revenue" ? `R$${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip formatter={(v: number) => mode === "revenue" ? BRL(v) : v.toLocaleString("pt-BR")} />
                <Bar dataKey="value" radius={[3,3,0,0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={ABC_COLORS[d.abc]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!loaded && !loading && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Carregando dados automaticamente... ou clique em <strong>Calcular</strong>.
        </CardContent></Card>
      )}
      {loading && (
        <Card><CardContent className="py-10 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <div className="text-xs text-muted-foreground mt-2">Buscando visitas e pedidos...</div>
        </CardContent></Card>
      )}
      {loaded && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {["Curva","Produto","Vendidos","Faturamento","Visitas","% Receita"].map(h => (
                    <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classified.map((item, i) => {
                  const totalRev = classified.reduce((s, x) => s + x.revenue, 0)
                  return (
                    <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Badge className="font-bold border-0 text-white" style={{ background: ABC_COLORS[item.abc] }}>{item.abc}</Badge>
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[200px]">
                        <div className="truncate" title={item.name}>{item.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{item.mlItemId}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{item.qty}</td>
                      <td className="px-3 py-2 font-semibold">{BRL(item.revenue)}</td>
                      <td className="px-3 py-2 font-mono">{item.visits.toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {totalRev > 0 ? ((item.revenue / totalRev) * 100).toFixed(1) + "%" : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
