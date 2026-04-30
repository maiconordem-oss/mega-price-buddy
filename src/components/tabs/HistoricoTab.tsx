import { useState, useMemo, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { BRL } from "@/services/ml-api"
import { useAnalytics, filterOrdersByDays, type Order } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { Loader2, Search, RefreshCw, Package, Clock } from "lucide-react"

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  paid:      { label: "Pago",       cls: "bg-green-500/15 text-green-700 border-0" },
  pending:   { label: "Pendente",   cls: "bg-yellow-400/20 text-yellow-700 border-0" },
  cancelled: { label: "Cancelado",  cls: "bg-red-500/15 text-red-700 border-0" },
}

export function HistoricoTab() {
  const { allOrders, loading, loaded, lastFetch, load } = useAnalytics()
  const [search,       setSearch]       = useState("")
  const [days,         setDays]         = useState(30)
  const [statusFilter, setStatusFilter] = useState("paid")

  useShopReset(useCallback(() => { setSearch("") }, []))

  // Filtra em memória — sem rebuscar
  const filtered = useMemo(() => {
    let list = filterOrdersByDays(allOrders, days)
    if (statusFilter !== "all") list = list.filter(o => o.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        String(o.id).includes(q) ||
        o.buyerNickname.toLowerCase().includes(q) ||
        o.items.some(i => i.title.toLowerCase().includes(q) || i.mlItemId.toLowerCase().includes(q))
      )
    }
    return list
  }, [allOrders, days, statusFilter, search])

  // Usa soma de unitPrice × qty (igual à aba Visitas & Vendas)
  // total_amount do ML inclui frete pago pelo comprador, gerando divergência
  const totalRevenue = filtered.reduce((s, o) =>
    s + o.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0), 0)

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Package />} label="Pedidos" value={filtered.length.toLocaleString("pt-BR")} />
        <StatCard icon={<Package />} label="Itens vendidos"
          value={filtered.reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0).toLocaleString("pt-BR")} />
        <StatCard icon={<Package />} label="Faturamento (produtos)" value={BRL(totalRevenue)} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar pedido, comprador ou produto..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={e => setDays(+e.target.value)}>
          {[7,30,60,90].map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">Todos os status</option>
          <option value="paid">Pagos</option>
          <option value="pending">Pendentes</option>
          <option value="cancelled">Cancelados</option>
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

      {/* Tabela */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Pedido","Data","Comprador","Produtos","Total","Status"].map(h => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  Carregando automaticamente... ou clique em <strong>Carregar</strong>.
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-3 py-10 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td></tr>
              )}
              {loaded && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  Nenhum pedido encontrado no período.
                </td></tr>
              )}
              {loaded && filtered.map(order => {
                const s = STATUS_LABEL[order.status] || { label: order.status, cls: "bg-muted text-muted-foreground border-0" }
                return (
                  <tr key={order.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{order.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {new Date(order.dateCreated).toLocaleDateString("pt-BR")}
                      <div className="text-muted-foreground">
                        {new Date(order.dateCreated).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{order.buyerNickname}</td>
                    <td className="px-3 py-2 max-w-[220px]">
                      {order.items.map((oi, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs truncate">
                          <span className="font-mono text-muted-foreground">×{oi.quantity}</span>
                          <span className="truncate" title={oi.title}>{oi.title || oi.mlItemId}</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        {BRL(order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}
                      </td>
                    <td className="px-3 py-2">
                      <Badge className={s.cls}>{s.label}</Badge>
                    </td>
                  </tr>
                )
              })}
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
