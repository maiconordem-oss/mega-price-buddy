import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ml, serverSave, serverLoad, toMLDate, chunks, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Eye, ShoppingCart, TrendingUp, Loader2, Search, RefreshCw } from "lucide-react";

interface VisitItem {
  name: string;
  sku: string;
  mlItemId: string;
  image: string;
  visits: number;
  sold: number;
  revenue: number;
  conversion: number;
  currentPrice: number;
}

const CACHE_KEY = "visitas-vendas";
const CACHE_TTL = 120; // 2h em minutos

export function VisitasTab() {
  const { products } = useProducts();
  const { userId } = useAuth();
  const [data, setData] = useState<VisitItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);

  const load = useCallback(
    async (force = false) => {
      if (!products.length) {
        toast.info("Carregue os produtos primeiro na aba Precificação.");
        return;
      }
      if (!userId) {
        toast.info("Conecte o Mercado Livre nas Configurações.");
        return;
      }

      if (!force && loaded) return;

      // Cache
      if (!force) {
        try {
          const cached = await serverLoad<VisitItem[]>(CACHE_KEY);
          if (cached?.data && cached?.ts) {
            const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
            if (age < CACHE_TTL) {
              setData(cached.data);
              setLoaded(true);
              return;
            }
          }
        } catch {}
      }

      setLoading(true);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - days * 86400000);
        const dateFrom = toMLDate(from);
        const dateTo = toMLDate(now);

        // Pega só produtos ML
        const mlItems = products.filter((p) => p.mlItemId);
        if (!mlItems.length) {
          toast.warning("Nenhum produto do ML carregado.");
          setLoading(false);
          return;
        }

        const itemIds = mlItems.map((p) => p.mlItemId!);

        // Visitas em lotes de 50
        const visitBatches = chunks(itemIds, 50);
        const visitMap: Record<string, number> = {};
        for (const batch of visitBatches) {
          const vRes = await ml(
            `/visits/items?ids=${batch.join(",")}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
          ) as Record<string, { total_visits: number }>;
          for (const [id, v] of Object.entries(vRes)) {
            visitMap[id] = (visitMap[id] || 0) + (v?.total_visits || 0);
          }
        }

        // Pedidos — busca os recentes
        const orderRes = await ml(
          `/orders/search?seller=${userId}&order.status=paid&sort=date_desc&limit=50&date_created_from=${encodeURIComponent(dateFrom)}`,
        ) as { results: Array<{ order_items: Array<{ item: { id: string }; quantity: number; unit_price: number }> }> };

        const soldMap: Record<string, { qty: number; revenue: number }> = {};
        for (const order of orderRes.results || []) {
          for (const oi of order.order_items || []) {
            const id = oi.item?.id;
            if (!id) continue;
            soldMap[id] = soldMap[id] || { qty: 0, revenue: 0 };
            soldMap[id].qty += oi.quantity;
            soldMap[id].revenue += oi.quantity * oi.unit_price;
          }
        }

        const result: VisitItem[] = mlItems.map((p) => {
          const id = p.mlItemId!;
          const visits = visitMap[id] || 0;
          const sold = soldMap[id]?.qty || 0;
          const revenue = soldMap[id]?.revenue || 0;
          const conversion = visits > 0 ? (sold / visits) * 100 : 0;
          const currentPrice = p.listings.find((l) => l.channel === "ml")?.currentPrice || 0;
          return { name: p.name, sku: p.sku, mlItemId: id, image: p.image, visits, sold, revenue, conversion, currentPrice };
        });

        result.sort((a, b) => b.visits - a.visits);
        setData(result);
        setLoaded(true);
        serverSave(CACHE_KEY, result).catch(() => {});
        toast.success("Visitas e vendas atualizadas");
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [products, userId, days, loaded],
  );

  const filtered = data.filter(
    (d) => !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const totalVisits = data.reduce((a, b) => a + b.visits, 0);
  const totalSold = data.reduce((a, b) => a + b.sold, 0);
  const totalRevenue = data.reduce((a, b) => a + b.revenue, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Eye />} label="Total Visitas" value={totalVisits.toLocaleString("pt-BR")} />
        <StatCard icon={<ShoppingCart />} label="Total Vendidos" value={totalSold.toLocaleString("pt-BR")} />
        <StatCard icon={<TrendingUp />} label="Faturamento" value={BRL(totalRevenue)} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={days}
          onChange={(e) => setDays(+e.target.value)}
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={60}>Últimos 60 dias</option>
          <option value={90}>Últimos 90 dias</option>
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
                {["Foto", "Produto", "SKU", "Preço", "Visitas", "Vendidos", "Receita", "Conversão", "Status"].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loaded && !loading && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">Clique em Carregar para buscar os dados.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="px-3 py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <img src={item.image} alt={item.name} className="h-10 w-10 rounded-md object-cover bg-muted"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  </td>
                  <td className="px-3 py-2 font-medium max-w-[180px]">
                    <div className="truncate" title={item.name}>{item.name}</div>
                    <a href={`https://www.mercadolivre.com.br/anuncio/${item.mlItemId}`}
                      target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary">
                      {item.mlItemId}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{item.sku}</td>
                  <td className="px-3 py-2 font-medium">{BRL(item.currentPrice)}</td>
                  <td className="px-3 py-2 font-mono">{item.visits.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2 font-mono font-semibold">{item.sold}</td>
                  <td className="px-3 py-2 font-semibold">{BRL(item.revenue)}</td>
                  <td className="px-3 py-2">
                    <Badge className={
                      item.conversion >= 3 ? "bg-green-500/15 text-green-700 border-0"
                      : item.conversion >= 1 ? "bg-yellow-400/20 text-yellow-700 border-0"
                      : "bg-red-500/15 text-red-700 border-0"
                    }>
                      {item.conversion.toFixed(1)}%
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {item.visits === 0 ? (
                      <Badge className="bg-muted text-muted-foreground border-0">Sem visitas</Badge>
                    ) : item.sold === 0 ? (
                      <Badge className="bg-orange-500/15 text-orange-700 border-0">Sem vendas</Badge>
                    ) : (
                      <Badge className="bg-green-500/15 text-green-700 border-0">Vendendo</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-primary/10 text-primary">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
