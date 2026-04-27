import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ml, serverSave, serverLoad, toMLDate, BRL } from "@/services/ml-api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Search, RefreshCw, Package } from "lucide-react";

interface Order {
  id: number;
  date: string;
  buyer: string;
  items: Array<{ title: string; quantity: number; unit_price: number; thumbnail?: string }>;
  total: number;
  status: string;
  paymentStatus: string;
}

const CACHE_KEY = "historico-pedidos";
const CACHE_TTL = 60;

function statusLabel(s: string) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Pago", cls: "bg-green-500/15 text-green-700 border-0" },
    cancelled: { label: "Cancelado", cls: "bg-red-500/15 text-red-700 border-0" },
    pending: { label: "Pendente", cls: "bg-yellow-400/20 text-yellow-700 border-0" },
    confirmed: { label: "Confirmado", cls: "bg-blue-500/15 text-blue-700 border-0" },
  };
  return map[s] || { label: s, cls: "bg-muted text-muted-foreground border-0" };
}

export function HistoricoTab() {
  const { userId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState("paid");

  const load = useCallback(
    async (force = false) => {
      if (!userId) { toast.info("Conecte o Mercado Livre."); return; }
      if (!force && loaded) return;

      if (!force) {
        try {
          const cached = await serverLoad<Order[]>(CACHE_KEY);
          if (cached?.data && cached?.ts) {
            const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
            if (age < CACHE_TTL) { setOrders(cached.data); setLoaded(true); return; }
          }
        } catch {}
      }

      setLoading(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - days * 86400000);
        const dateFrom = encodeURIComponent(toMLDate(from));

        const res = await ml(
          `/orders/search?seller=${userId}&order.status=${statusFilter}&sort=date_desc&limit=50&date_created_from=${dateFrom}`,
        ) as {
          results: Array<{
            id: number;
            date_created: string;
            buyer: { nickname: string };
            order_items: Array<{ item: { id: string; title: string; thumbnail?: string }; quantity: number; unit_price: number }>;
            total_amount: number;
            status: string;
            payments: Array<{ status: string }>;
          }>;
        };

        const parsed: Order[] = (res.results || []).map((o) => ({
          id: o.id,
          date: o.date_created,
          buyer: o.buyer?.nickname || "—",
          items: (o.order_items || []).map((oi) => ({
            title: oi.item?.title || "—",
            quantity: oi.quantity,
            unit_price: oi.unit_price,
            thumbnail: oi.item?.thumbnail?.replace("http:", "https:"),
          })),
          total: o.total_amount,
          status: o.status,
          paymentStatus: o.payments?.[0]?.status || o.status,
        }));

        setOrders(parsed);
        setLoaded(true);
        serverSave(CACHE_KEY, parsed).catch(() => {});
        toast.success(`${parsed.length} pedidos carregados`);
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [userId, days, statusFilter, loaded],
  );

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(o.id).includes(q) ||
      o.buyer.toLowerCase().includes(q) ||
      o.items.some((i) => i.title.toLowerCase().includes(q))
    );
  });

  const totalRevenue = orders.reduce((a, b) => a + b.total, 0);
  const avgTicket = orders.length ? totalRevenue / orders.length : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Package /></div>
          <div><div className="text-xs text-muted-foreground">Total Pedidos</div><div className="text-2xl font-bold">{orders.length}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-green-500/10 text-green-600 flex items-center justify-center">R$</div>
          <div><div className="text-xs text-muted-foreground">Faturamento</div><div className="text-2xl font-bold">{BRL(totalRevenue)}</div></div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">~</div>
          <div><div className="text-xs text-muted-foreground">Ticket Médio</div><div className="text-2xl font-bold">{BRL(avgTicket)}</div></div>
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Pedido, comprador, produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={(e) => { setDays(+e.target.value); setLoaded(false); }}>
          <option value={7}>7 dias</option>
          <option value={30}>30 dias</option>
          <option value={60}>60 dias</option>
          <option value={90}>90 dias</option>
        </select>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setLoaded(false); }}>
          <option value="paid">Pagos</option>
          <option value="pending">Pendentes</option>
          <option value="cancelled">Cancelados</option>
        </select>
        <Button size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar" : "Carregar"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Pedido", "Data", "Comprador", "Produtos", "Total", "Status"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Clique em Carregar.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="px-3 py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              )}
              {filtered.map((o) => {
                const st = statusLabel(o.status);
                return (
                  <tr key={o.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{o.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {new Date(o.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2 font-medium">{o.buyer}</td>
                    <td className="px-3 py-2 max-w-[260px]">
                      {o.items.map((item, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          {item.thumbnail && <img src={item.thumbnail} className="h-6 w-6 rounded object-cover" alt="" />}
                          <span className="truncate">{item.quantity}× {item.title}</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 font-semibold">{BRL(o.total)}</td>
                    <td className="px-3 py-2"><Badge className={st.cls}>{st.label}</Badge></td>
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
