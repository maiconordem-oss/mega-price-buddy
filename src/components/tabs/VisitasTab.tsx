import { useState, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BRL } from "@/services/ml-api"
import { useProducts } from "@/contexts/ProductsContext"
import { useAnalytics, filterOrdersByDays, buildOrderMap } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { Eye, ShoppingCart, TrendingUp, Loader2, Search, RefreshCw, Clock } from "lucide-react"

export function VisitasTab() {
  const { products } = useProducts()
  const { visitMap, allOrders, loading, loaded, lastFetch, load } = useAnalytics()
  const [search, setSearch] = useState("")
  const [days,   setDays]   = useState(30)

  useShopReset(() => setSearch(""))

  // Filtra pedidos pelo período selecionado e reconstrói orderMap local
  const filteredOrders = useMemo(() => filterOrdersByDays(allOrders, days), [allOrders, days])
  const orderMap       = useMemo(() => buildOrderMap(filteredOrders), [filteredOrders])

  const data = useMemo(() => {
    const mlItems = products.filter(p => p.mlItemId)
    return mlItems.map(p => {
      const id           = p.mlItemId!
      const visits       = visitMap[id] || 0
      const sold         = orderMap[id]?.qty || 0
      const revenue      = orderMap[id]?.revenue || 0
      const conversion   = visits > 0 ? (sold / visits) * 100 : 0
      const currentPrice = p.listings.find(l => l.channel === "ml")?.currentPrice || 0
      return { name: p.name, sku: p.sku, mlItemId: id, image: p.image, visits, sold, revenue, conversion, currentPrice }
    }).sort((a, b) => b.visits - a.visits)
  }, [products, visitMap, orderMap])

  const filtered = useMemo(() =>
    !search ? data : data.filter(d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.sku.toLowerCase().includes(search.toLowerCase())
    ), [data, search])

  const totalVisits  = data.reduce((a, b) => a + b.visits, 0)
  const totalSold    = data.reduce((a, b) => a + b.sold, 0)
  const totalRevenue = data.reduce((a, b) => a + b.revenue, 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Eye />}          label="Total Visitas"  value={totalVisits.toLocaleString("pt-BR")} />
        <StatCard icon={<ShoppingCart />} label="Total Vendidos" value={totalSold.toLocaleString("pt-BR")} />
        <StatCard icon={<TrendingUp />}   label="Faturamento"    value={BRL(totalRevenue)} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar produto ou SKU..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={e => setDays(+e.target.value)}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
        {lastFetch && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastFetch.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Carregar"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Foto","Produto","SKU","Preço","Visitas","Vendidos","Receita","Conversão","Status"].map(h => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  {products.filter(p => p.mlItemId).length === 0
                    ? <span>Carregue os produtos do ML na aba <strong>Precificação</strong> primeiro.</span>
                    : <span>Clique em <strong>Carregar</strong> para buscar visitas e vendas.</span>}
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="px-3 py-10 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  <div className="text-xs text-muted-foreground mt-2">Buscando visitas e pedidos (90 dias)...</div>
                </td></tr>
              )}
              {loaded && filtered.map(item => (
                <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <img src={item.image} alt="" className="h-10 w-10 rounded-md object-cover bg-muted"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-[180px]">
                    <div className="truncate" title={item.name}>{item.name}</div>
                    <a href={`https://produto.mercadolivre.com.br/${item.mlItemId.replace("MLB","MLB-")}`}
                      target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary">
                      {item.mlItemId}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{item.sku}</td>
                  <td className="px-3 py-2 font-medium">{BRL(item.currentPrice)}</td>
                  <td className="px-3 py-2 font-mono">{item.visits.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 font-mono font-semibold">{item.sold}</td>
                  <td className="px-3 py-2 font-semibold">{BRL(item.revenue)}</td>
                  <td className="px-3 py-2">
                    <Badge className={
                      item.conversion >= 3 ? "bg-green-500/15 text-green-700 border-0"
                      : item.conversion >= 1 ? "bg-yellow-400/20 text-yellow-700 border-0"
                      : "bg-red-500/15 text-red-700 border-0"
                    }>{item.conversion.toFixed(1)}%</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {item.visits === 0
                      ? <Badge className="bg-muted text-muted-foreground border-0">Sem visitas</Badge>
                      : item.sold === 0
                      ? <Badge className="bg-orange-500/15 text-orange-700 border-0">Sem vendas</Badge>
                      : <Badge className="bg-green-500/15 text-green-700 border-0">Vendendo</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card><CardContent className="p-5 flex items-center gap-4">
      <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-primary/10 text-primary">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        <div className="text-xl font-bold">{value}</div>
      </div>
    </CardContent></Card>
  )
}
