import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ml, serverSave, serverLoad, BRL } from "@/services/ml-api";
import { useProducts } from "@/contexts/ProductsContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, RefreshCw, Star, Shield, TrendingUp, AlertTriangle } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

interface Reputation {
  level_id: string;
  power_seller_status: string | null;
  transactions: {
    completed: number;
    canceled: number;
    period: string;
    ratings: { negative: number; neutral: number; positive: number };
  };
  metrics: {
    sales: { period: string; completed: number };
    claims: { rate: number; period: string; value: number };
    delayed_handling_time: { rate: number; period: string; value: number };
    cancellations: { rate: number; period: string; value: number };
  };
}

interface AnaliseItem {
  sku: string;
  name: string;
  mlItemId: string;
  currentPrice: number;
  cost: number;
  shipping: number;
  fee: number;
  margin: number;
  listing_type: string;
  status: string;
  health?: number;
}

const CACHE_KEY = "analise-produtos";
const CACHE_TTL = 60;
const LEVELS: Record<string, { label: string; cls: string }> = {
  "1_red": { label: "Novo", cls: "bg-gray-500/15 text-gray-600 border-0" },
  "2_orange": { label: "Bronze", cls: "bg-orange-500/15 text-orange-700 border-0" },
  "3_light_green": { label: "Prata", cls: "bg-blue-500/15 text-blue-700 border-0" },
  "4_green": { label: "Ouro", cls: "bg-yellow-500/20 text-yellow-700 border-0" },
  "5_dark_green": { label: "Platina", cls: "bg-green-500/15 text-green-700 border-0" },
};

export function AnaliseTab() {
  const { products, params } = useProducts();
  const { userId } = useAuth();
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [items, setItems] = useState<AnaliseItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!userId) { toast.info("Conecte o Mercado Livre."); return; }
      if (!force && loaded) return;

      if (!force) {
        try {
          const cached = await serverLoad<{ reputation: Reputation; items: AnaliseItem[] }>(CACHE_KEY);
          if (cached?.data && cached?.ts) {
            const age = (Date.now() - new Date(cached.ts).getTime()) / 60000;
            if (age < CACHE_TTL) {
              setReputation(cached.data.reputation);
              setItems(cached.data.items);
              setLoaded(true);
              return;
            }
          }
        } catch {}
      }

      setLoading(true);
      try {
        // Reputação
        const userProfile = await ml(`/users/${userId}`) as { seller_reputation: Reputation; nickname: string };
        const rep = userProfile.seller_reputation;
        setReputation(rep);

        // Análise de margens por produto
        const analyzed: AnaliseItem[] = products
          .filter((p) => p.mlItemId)
          .map((p) => {
            const listing = p.listings.find((l) => l.channel === "ml");
            const price = listing?.currentPrice || 0;
            const fee = params.fees.ml;
            const totalCost = p.cost + p.shipping + params.packaging;
            const margin = price > 0
              ? ((price - totalCost - (price * (fee + params.tax)) / 100) / price) * 100
              : 0;
            return {
              sku: p.sku,
              name: p.name,
              mlItemId: p.mlItemId!,
              currentPrice: price,
              cost: p.cost,
              shipping: p.shipping,
              fee,
              margin,
              listing_type: listing ? "gold_special" : "—",
              status: margin >= params.targetMargin ? "ok" : margin >= 0 ? "atencao" : "prejuizo",
            };
          })
          .sort((a, b) => a.margin - b.margin);

        setItems(analyzed);
        setLoaded(true);
        serverSave(CACHE_KEY, { reputation: rep, items: analyzed }).catch(() => {});
        toast.success("Análise concluída");
      } catch (e) {
        toast.error("Erro: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [userId, products, params, loaded],
  );

  const radarData = reputation
    ? [
        { subject: "Positivos", value: Math.round((reputation.transactions.ratings?.positive / Math.max(reputation.transactions.completed, 1)) * 100) },
        { subject: "Vendas", value: Math.min(reputation.metrics.sales?.completed || 0, 100) },
        { subject: "Sem Claims", value: Math.round((1 - (reputation.metrics.claims?.rate || 0)) * 100) },
        { subject: "Pontualidade", value: Math.round((1 - (reputation.metrics.delayed_handling_time?.rate || 0)) * 100) },
        { subject: "Sem Cancel.", value: Math.round((1 - (reputation.metrics.cancellations?.rate || 0)) * 100) },
      ]
    : [];

  const repLevel = reputation ? LEVELS[reputation.level_id] || { label: reputation.level_id, cls: "bg-muted text-muted-foreground border-0" } : null;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => load(true)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          {loaded ? "Atualizar Análise" : "Carregar Análise"}
        </Button>
      </div>

      {reputation && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Reputação */}
          <Card>
            <CardHeader className="flex-row items-center gap-3 pb-3">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Reputação ML</CardTitle>
              {repLevel && <Badge className={repLevel.cls}>{repLevel.label}</Badge>}
              {reputation.power_seller_status && <Badge className="bg-yellow-400/20 text-yellow-700 border-0">⭐ MercadoLíder</Badge>}
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Transações" value={reputation.transactions.completed.toLocaleString("pt-BR")} />
              <Metric label="Cancelamentos" value={`${((reputation.metrics.cancellations?.rate || 0) * 100).toFixed(1)}%`}
                warn={(reputation.metrics.cancellations?.rate || 0) > 0.02} />
              <Metric label="Reclamações" value={`${((reputation.metrics.claims?.rate || 0) * 100).toFixed(1)}%`}
                warn={(reputation.metrics.claims?.rate || 0) > 0.01} />
              <Metric label="Atraso entrega" value={`${((reputation.metrics.delayed_handling_time?.rate || 0) * 100).toFixed(1)}%`}
                warn={(reputation.metrics.delayed_handling_time?.rate || 0) > 0.05} />
              <Metric label="Avaliações +" value={reputation.transactions.ratings?.positive?.toLocaleString("pt-BR") || "0"} />
              <Metric label="Avaliações -" value={reputation.transactions.ratings?.negative?.toLocaleString("pt-BR") || "0"} warn={(reputation.transactions.ratings?.negative || 0) > 0} />
            </CardContent>
          </Card>

          {/* Radar */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Star className="h-5 w-5 text-yellow-500" /> Score de Saúde</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => v + "%"} />
                  <Radar dataKey="value" stroke="#2D3277" fill="#2D3277" fillOpacity={0.25} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Margin analysis */}
      {loaded && items.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Análise de Margem por Produto</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {["Produto", "Custo", "Frete", "Taxa ML", "Preço Atual", "Margem Real", "Status"].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.mlItemId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium max-w-[200px]">
                      <div className="truncate" title={item.name}>{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                    </td>
                    <td className="px-3 py-2">{BRL(item.cost)}</td>
                    <td className="px-3 py-2">{BRL(item.shipping)}</td>
                    <td className="px-3 py-2">{item.fee}%</td>
                    <td className="px-3 py-2 font-semibold">{BRL(item.currentPrice)}</td>
                    <td className={`px-3 py-2 font-bold ${item.margin < 0 ? "text-red-600" : item.margin < params.targetMargin ? "text-yellow-600" : "text-green-600"}`}>
                      {item.margin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2">
                      {item.status === "ok"
                        ? <Badge className="bg-green-500/15 text-green-700 border-0">✓ OK</Badge>
                        : item.status === "atencao"
                        ? <Badge className="bg-yellow-400/20 text-yellow-700 border-0">⚠ Atenção</Badge>
                        : <Badge className="bg-red-500/15 text-red-700 border-0">✗ Prejuízo</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!loaded && !loading && (
        <Card><CardContent className="p-12 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p>Clique em <strong>Carregar Análise</strong> para ver dados de reputação e margens.</p>
        </CardContent></Card>
      )}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${warn ? "bg-red-50 border border-red-200" : "bg-muted/50"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${warn ? "text-red-600" : ""}`}>{value}</div>
    </div>
  );
}
