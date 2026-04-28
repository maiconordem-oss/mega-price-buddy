import { useState, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ml, serverSave, serverLoad, BRL, chunks } from "@/services/ml-api"
import { useProducts } from "@/contexts/ProductsContext"
import { useAuth } from "@/contexts/AuthContext"
import { useAnalytics } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { computePricingRow, getTier } from "@/lib/pricing"
import { toast } from "sonner"
import {
  Loader2, RefreshCw, Search, Shield, Star, TrendingUp,
  AlertTriangle, Eye, ShoppingCart, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Clock, Package, BarChart2, DollarSign,
} from "lucide-react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Cell,
} from "recharts"

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Reputation {
  level_id: string
  power_seller_status: string | null
  transactions: {
    completed: number; canceled: number; period: string
    ratings: { negative: number; neutral: number; positive: number }
  }
  metrics: {
    sales:                 { period: string; completed: number }
    claims:                { rate: number; period: string; value: number }
    delayed_handling_time: { rate: number; period: string; value: number }
    cancellations:         { rate: number; period: string; value: number }
  }
}

interface BenchmarkData {
  current_price:     number
  suggested_price:   number
  lowest_price:      number
  percent_difference: number
  selling_fees:      number
  shipping_fees:     number
}

interface QuestionData {
  total: number
  unanswered: number
}

interface ItemHealth {
  status: string
  score?: number
}

interface AnuncioAnalise {
  // produto base
  mlItemId:        string
  name:            string
  sku:             string
  image:           string
  listing_type_id: string
  status:          string
  available_qty:   number
  currentPrice:    number
  cost:            number

  // financeiro (calculado)
  margin:     number
  lucro:      number
  idealPrice: number
  marginStatus: "ok" | "low" | "nocost"

  // analytics (90 dias)
  visits:     number
  sold:       number
  revenue:    number
  conversion: number
  abcClass:   "A" | "B" | "C" | "—"

  // API extras
  benchmark:  BenchmarkData | null
  questions:  QuestionData
  health:     ItemHealth | null

  // alertas gerados
  alerts: string[]
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CACHE_KEY = "analise-completa-v2"
const CACHE_TTL = 240 // 4h

const LEVELS: Record<string, { label: string; color: string }> = {
  "1_red":         { label: "Novo",    color: "#888" },
  "2_orange":      { label: "Bronze",  color: "#c87533" },
  "3_light_green": { label: "Prata",   color: "#185FA5" },
  "4_green":       { label: "Ouro",    color: "#8a5c00" },
  "5_dark_green":  { label: "Platina", color: "#1a7a45" },
}

const TYPE_LABEL: Record<string, string> = {
  gold_pro:     "PREMIUM",
  gold_special: "CLÁSSICO",
  gold:         "OURO",
  silver:       "PRATA",
  free:         "GRÁTIS",
}

// ── Componente principal ──────────────────────────────────────────────────────

export function AnaliseTab() {
  const { products, params } = useProducts()
  const { userId } = useAuth()
  const { visitMap, orderMap, allOrders, loaded: analyticsLoaded } = useAnalytics()

  const [reputation,    setReputation]    = useState<Reputation | null>(null)
  const [anuncios,      setAnuncios]      = useState<AnuncioAnalise[]>([])
  const [loaded,        setLoaded]        = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [loadingStep,   setLoadingStep]   = useState("")
  const [search,        setSearch]        = useState("")
  const [expanded,      setExpanded]      = useState<string | null>(null)
  const [filterAlert,   setFilterAlert]   = useState(false)
  const [filterStatus,  setFilterStatus]  = useState<"all"|"ok"|"low"|"nocost">("all")

  useShopReset(useCallback(() => {
    setReputation(null); setAnuncios([]); setLoaded(false)
  }, []))

  // ── Load completo ─────────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!userId) { toast.info("Conecte o Mercado Livre."); return }
    if (loadingStep) return

    if (!force) {
      try {
        const cached = await serverLoad<{ reputation: Reputation; anuncios: AnuncioAnalise[] }>(CACHE_KEY)
        if (cached?.data && cached?.ts) {
          const age = (Date.now() - new Date(cached.ts).getTime()) / 60000
          if (age < CACHE_TTL) {
            setReputation(cached.data.reputation)
            setAnuncios(cached.data.anuncios)
            setLoaded(true)
            return
          }
        }
      } catch {}
    }

    setLoading(true)

    try {
      // ── 1. Reputação ──────────────────────────────────────────────────────
      setLoadingStep("Buscando reputação...")
      const userProfile = await ml(`/users/${userId}`) as {
        seller_reputation: Reputation; nickname: string
      }
      const rep = userProfile.seller_reputation
      setReputation(rep)

      // ── 2. Pré-calcula ABC com dados do AnalyticsContext ─────────────────
      setLoadingStep("Calculando ABC...")
      const mlProducts = products.filter(p => p.mlItemId)
      if (!mlProducts.length) { toast.info("Carregue os produtos primeiro."); return }

      const revenueList = mlProducts
        .map(p => ({ id: p.mlItemId!, rev: orderMap[p.mlItemId!]?.revenue || 0 }))
        .sort((a, b) => b.rev - a.rev)
      const totalRev = revenueList.reduce((s, x) => s + x.rev, 0)
      const abcMap: Record<string, "A"|"B"|"C"> = {}
      let acc = 0
      for (const r of revenueList) {
        acc += r.rev
        const pct = totalRev > 0 ? acc / totalRev : 1
        abcMap[r.id] = pct <= 0.70 ? "A" : pct <= 0.90 ? "B" : "C"
      }

      // ── 3. Benchmark por produto (lotes de 5) ────────────────────────────
      setLoadingStep("Buscando benchmarks de preço...")
      const benchmarkMap: Record<string, BenchmarkData | null> = {}
      for (const batch of chunks(mlProducts, 5)) {
        await Promise.all(batch.map(async p => {
          try {
            const res = await ml(`/marketplace/benchmarks/items/${p.mlItemId}/details`) as BenchmarkData
            benchmarkMap[p.mlItemId!] = res
          } catch { benchmarkMap[p.mlItemId!] = null }
        }))
        await new Promise(r => setTimeout(r, 300))
      }

      // ── 4. Perguntas sem resposta (lotes de 5) ───────────────────────────
      setLoadingStep("Buscando perguntas...")
      const questionMap: Record<string, QuestionData> = {}
      for (const batch of chunks(mlProducts, 5)) {
        await Promise.all(batch.map(async p => {
          try {
            const res = await ml(
              `/questions/search?item=${p.mlItemId}&status=UNANSWERED&limit=1`
            ) as { total: number; questions: unknown[] }
            const resAll = await ml(
              `/questions/search?item=${p.mlItemId}&limit=1`
            ) as { total: number }
            questionMap[p.mlItemId!] = { total: resAll.total, unanswered: res.total }
          } catch { questionMap[p.mlItemId!] = { total: 0, unanswered: 0 } }
        }))
        await new Promise(r => setTimeout(r, 300))
      }

      // ── 5. Health score (lotes de 5) ─────────────────────────────────────
      setLoadingStep("Buscando health score...")
      const healthMap: Record<string, ItemHealth | null> = {}
      for (const batch of chunks(mlProducts, 5)) {
        await Promise.all(batch.map(async p => {
          try {
            const res = await ml(`/items/${p.mlItemId}/health`) as ItemHealth
            healthMap[p.mlItemId!] = res
          } catch { healthMap[p.mlItemId!] = null }
        }))
        await new Promise(r => setTimeout(r, 300))
      }

      // ── 6. Monta análise por anúncio ──────────────────────────────────────
      setLoadingStep("Consolidando análise...")
      const result: AnuncioAnalise[] = mlProducts.map(p => {
        const row          = computePricingRow(p, params)
        const id           = p.mlItemId!
        const visits       = visitMap[id] || 0
        const sold         = orderMap[id]?.qty || 0
        const revenue      = orderMap[id]?.revenue || 0
        const conversion   = visits > 0 ? (sold / visits) * 100 : 0
        const bench        = benchmarkMap[id] || null
        const q            = questionMap[id] || { total: 0, unanswered: 0 }
        const health       = healthMap[id] || null
        const currentPrice = row.effectivePrice
        const tier         = getTier(p.listing_type_id)
        const idealPrice   = tier === 1 ? row.idealP : row.idealC

        // Gera alertas automáticos
        const alerts: string[] = []
        if (row.margin < 0)                              alerts.push("Margem negativa")
        if (row.status === "nocost")                     alerts.push("Sem custo cadastrado")
        if (row.margin < row.marginTarget && row.margin >= 0) alerts.push("Abaixo da margem mínima")
        if (visits === 0 && analyticsLoaded)             alerts.push("Sem visitas (90 dias)")
        if (visits > 0 && conversion < 1)               alerts.push("Conversão crítica (<1%)")
        if (q.unanswered > 0)                            alerts.push(`${q.unanswered} pergunta(s) sem resposta`)
        if (bench && bench.percent_difference < -10)     alerts.push("Preço acima do mercado")
        if ((p as any).available_quantity === 0)         alerts.push("Estoque zerado")
        if (sold === 0 && analyticsLoaded)               alerts.push("Sem vendas (90 dias)")

        return {
          mlItemId:        id,
          name:            p.name,
          sku:             p.sku,
          image:           p.image,
          listing_type_id: p.listing_type_id || "gold_special",
          status:          "active",
          available_qty:   (p as any).available_quantity || 0,
          currentPrice,
          cost:            p.cost,
          margin:          row.margin * 100,
          lucro:           row.lucro,
          idealPrice,
          marginStatus:    row.status,
          visits, sold, revenue, conversion,
          abcClass: abcMap[id] || "—",
          benchmark: bench,
          questions: q,
          health,
          alerts,
        }
      }).sort((a, b) => b.revenue - a.revenue)

      setAnuncios(result)
      setLoaded(true)
      serverSave(CACHE_KEY, { reputation: rep, anuncios: result }).catch(() => {})
      toast.success(`${result.length} anúncios analisados`)
    } catch (e) {
      toast.error("Erro: " + (e as Error).message)
    } finally {
      setLoading(false)
      setLoadingStep("")
    }
  }, [userId, products, params, visitMap, orderMap, analyticsLoaded])

  // ── Filtros ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = anuncios
    if (filterAlert)            list = list.filter(a => a.alerts.length > 0)
    if (filterStatus !== "all") list = list.filter(a => a.marginStatus === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.sku.toLowerCase().includes(q) ||
        a.mlItemId.toLowerCase().includes(q)
      )
    }
    return list
  }, [anuncios, filterAlert, filterStatus, search])

  // ── Reputação radar ───────────────────────────────────────────────────────
  const radarData = reputation ? [
    { subject: "Positivos",   value: Math.round((reputation.transactions.ratings?.positive / Math.max(reputation.transactions.completed, 1)) * 100) },
    { subject: "Vendas",      value: Math.min(reputation.metrics.sales?.completed || 0, 100) },
    { subject: "Sem claims",  value: Math.round((1 - (reputation.metrics.claims?.rate || 0)) * 100) },
    { subject: "Pontualidade",value: Math.round((1 - (reputation.metrics.delayed_handling_time?.rate || 0)) * 100) },
    { subject: "Sem cancel.", value: Math.round((1 - (reputation.metrics.cancellations?.rate || 0)) * 100) },
  ] : []

  const repLevel = reputation
    ? LEVELS[reputation.level_id] || { label: reputation.level_id, color: "#888" }
    : null

  // ── KPIs globais ──────────────────────────────────────────────────────────
  const totalRevenue    = anuncios.reduce((s, a) => s + a.revenue, 0)
  const totalSold       = anuncios.reduce((s, a) => s + a.sold, 0)
  const totalVisits     = anuncios.reduce((s, a) => s + a.visits, 0)
  const alertCount      = anuncios.filter(a => a.alerts.length > 0).length
  const avgMargin       = anuncios.filter(a => a.cost > 0).length > 0
    ? anuncios.filter(a => a.cost > 0).reduce((s, a) => s + a.margin, 0) / anuncios.filter(a => a.cost > 0).length
    : 0
  const topBarChart     = anuncios.slice(0, 10).map(a => ({
    name:  a.name.length > 18 ? a.name.slice(0, 18) + "…" : a.name,
    value: a.revenue,
    abc:   a.abcClass,
  }))

  const ABC_COLOR = { A: "#1a7a45", B: "#8a5c00", C: "#c0392b", "—": "#888" }

  return (
    <div className="space-y-5">

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar anúncio, SKU, ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
          <option value="all">Todos os status</option>
          <option value="ok">✓ Margem OK</option>
          <option value="low">⚠ Abaixo da meta</option>
          <option value="nocost">✗ Sem custo</option>
        </select>
        <button
          onClick={() => setFilterAlert(v => !v)}
          className={`h-9 px-3 rounded-md border text-sm font-medium transition-colors ${filterAlert ? "bg-red-50 border-red-300 text-red-700" : "border-border hover:bg-muted"}`}>
          {filterAlert ? "✗ Só alertas" : "Filtrar alertas"}
        </button>
        <Button size="sm" onClick={() => load(true)} disabled={loading} className="ml-auto">
          {loading
            ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />{loadingStep || "Analisando..."}</>
            : <><RefreshCw className="h-4 w-4 mr-1.5" />{loaded ? "Atualizar análise" : "Analisar tudo"}</>}
        </Button>
      </div>

      {/* ── Estado vazio ───────────────────────────────────────────────────── */}
      {!loaded && !loading && (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <BarChart2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-medium">Análise completa por anúncio</p>
            <p className="text-sm mt-1">Busca reputação, benchmark de preço, perguntas, health score e cruza com visitas e vendas.</p>
            <Button className="mt-4" onClick={() => load(false)}>
              <BarChart2 className="h-4 w-4 mr-2" /> Iniciar análise
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
            <p className="font-medium text-sm">{loadingStep}</p>
            <p className="text-xs text-muted-foreground mt-1">Buscando dados de todos os anúncios...</p>
          </CardContent>
        </Card>
      )}

      {loaded && (<>

        {/* ── KPIs globais ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard icon={<DollarSign className="h-4 w-4" />} label="Faturamento 90d" value={BRL(totalRevenue)} />
          <KpiCard icon={<ShoppingCart className="h-4 w-4" />} label="Vendidos 90d" value={totalSold.toLocaleString("pt-BR")} />
          <KpiCard icon={<Eye className="h-4 w-4" />} label="Visitas 90d" value={totalVisits.toLocaleString("pt-BR")} />
          <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Margem média" value={`${avgMargin.toFixed(1)}%`}
            color={avgMargin >= params.targetMargin ? "green" : "red"} />
          <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Com alertas"
            value={`${alertCount} anúncios`} color={alertCount > 0 ? "red" : "green"} />
        </div>

        {/* ── Reputação + gráfico top 10 ───────────────────────────────────── */}
        {reputation && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Reputação */}
            <Card>
              <CardHeader className="flex-row items-center gap-2 pb-3">
                <Shield className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Reputação do vendedor</CardTitle>
                {repLevel && (
                  <Badge style={{ background: repLevel.color + "22", color: repLevel.color, border: "none" }}>
                    {repLevel.label}
                  </Badge>
                )}
                {reputation.power_seller_status && (
                  <Badge className="bg-yellow-400/20 text-yellow-700 border-0">MercadoLíder</Badge>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <RepMetric label="Transações"       value={reputation.transactions.completed.toLocaleString("pt-BR")} />
                  <RepMetric label="Cancelamentos"    value={`${((reputation.metrics.cancellations?.rate||0)*100).toFixed(1)}%`}
                    warn={(reputation.metrics.cancellations?.rate||0) > 0.02} />
                  <RepMetric label="Reclamações"      value={`${((reputation.metrics.claims?.rate||0)*100).toFixed(1)}%`}
                    warn={(reputation.metrics.claims?.rate||0) > 0.01} />
                  <RepMetric label="Atraso envio"     value={`${((reputation.metrics.delayed_handling_time?.rate||0)*100).toFixed(1)}%`}
                    warn={(reputation.metrics.delayed_handling_time?.rate||0) > 0.05} />
                  <RepMetric label="Aval. positivas"  value={(reputation.transactions.ratings?.positive||0).toLocaleString("pt-BR")} />
                  <RepMetric label="Aval. negativas"  value={(reputation.transactions.ratings?.negative||0).toLocaleString("pt-BR")}
                    warn={(reputation.transactions.ratings?.negative||0) > 0} />
                </div>
                <ResponsiveContainer width="100%" height={170}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => v + "%"} />
                    <Radar dataKey="value" stroke="#2D3277" fill="#2D3277" fillOpacity={0.2} />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top 10 faturamento */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-5 w-5 text-yellow-500" /> Top 10 por faturamento (90d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={topBarChart} layout="vertical" margin={{ left: 0, right: 10 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }}
                      tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                    <Tooltip formatter={(v: number) => BRL(v)} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                      {topBarChart.map((d, i) => (
                        <Cell key={i} fill={ABC_COLOR[d.abc as keyof typeof ABC_COLOR] || "#888"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Tabela de anúncios ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">
              Análise por anúncio
              <span className="text-muted-foreground font-normal text-sm ml-2">
                {filtered.length} de {anuncios.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {["","Anúncio","Tipo","Visitas","Vendas","Faturamento","Margem","Lucro","Preço ideal","Benchmark","ABC","Alertas"].map(h => (
                    <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const isOpen = expanded === a.mlItemId
                  const tier   = TYPE_LABEL[a.listing_type_id] || a.listing_type_id
                  const benchDiff = a.benchmark?.percent_difference ?? null
                  return (<>
                    <tr
                      key={a.mlItemId}
                      className={`border-t cursor-pointer hover:bg-muted/30 transition-colors ${isOpen ? "bg-[#E8EDFF]/40" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : a.mlItemId)}
                    >
                      {/* expand */}
                      <td className="px-3 py-2 text-muted-foreground">
                        {isOpen
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </td>
                      {/* nome */}
                      <td className="px-3 py-2 max-w-[180px]">
                        <div className="flex items-center gap-2">
                          <img src={a.image} alt="" className="h-8 w-8 rounded-md object-cover bg-muted shrink-0"
                            onError={e => { (e.target as HTMLImageElement).style.display="none" }} />
                          <div>
                            <div className="font-medium truncate max-w-[130px]" title={a.name}>{a.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{a.mlItemId}</div>
                          </div>
                        </div>
                      </td>
                      {/* tipo */}
                      <td className="px-3 py-2">
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{
                          background: a.listing_type_id === "gold_pro" ? "#FFE600" : "#E8EDFF",
                          color: "#2D3277"
                        }}>{tier}</span>
                      </td>
                      {/* visitas */}
                      <td className="px-3 py-2 font-mono text-sm">{a.visits.toLocaleString("pt-BR")}</td>
                      {/* vendas */}
                      <td className="px-3 py-2 font-mono text-sm">{a.sold}</td>
                      {/* faturamento */}
                      <td className="px-3 py-2 font-semibold">{BRL(a.revenue)}</td>
                      {/* margem */}
                      <td className="px-3 py-2">
                        <span className={`font-bold text-sm ${a.margin < 0 ? "text-red-600" : a.marginStatus === "ok" ? "text-green-700" : "text-yellow-700"}`}>
                          {a.marginStatus === "nocost" ? "—" : `${a.margin.toFixed(1)}%`}
                        </span>
                      </td>
                      {/* lucro */}
                      <td className="px-3 py-2 text-sm font-medium">
                        {a.marginStatus === "nocost" ? "—" : (
                          <span className={a.lucro < 0 ? "text-red-600" : "text-green-700"}>{BRL(a.lucro)}</span>
                        )}
                      </td>
                      {/* preço ideal */}
                      <td className="px-3 py-2 text-sm">
                        {a.idealPrice > 0 ? (
                          <span className={a.currentPrice >= a.idealPrice ? "text-green-700" : "text-red-600"}>
                            {BRL(a.idealPrice)}
                          </span>
                        ) : "—"}
                      </td>
                      {/* benchmark */}
                      <td className="px-3 py-2">
                        {benchDiff !== null ? (
                          <Badge className={
                            benchDiff >= 0
                              ? "bg-green-500/15 text-green-700 border-0"
                              : benchDiff >= -10
                              ? "bg-yellow-400/20 text-yellow-700 border-0"
                              : "bg-red-500/15 text-red-700 border-0"
                          }>
                            {benchDiff >= 0 ? "+" : ""}{benchDiff.toFixed(0)}%
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      {/* ABC */}
                      <td className="px-3 py-2">
                        {a.abcClass !== "—" ? (
                          <span className="font-black text-sm" style={{ color: ABC_COLOR[a.abcClass] }}>
                            {a.abcClass}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      {/* alertas */}
                      <td className="px-3 py-2">
                        {a.alerts.length > 0 ? (
                          <Badge className="bg-red-500/15 text-red-700 border-0">
                            {a.alerts.length} alerta{a.alerts.length > 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <Badge className="bg-green-500/15 text-green-700 border-0">OK</Badge>
                        )}
                      </td>
                    </tr>

                    {/* ── Painel expandido ──────────────────────────────────── */}
                    {isOpen && (
                      <tr key={a.mlItemId + "-detail"} className="bg-[#E8EDFF]/20">
                        <td colSpan={12} className="px-4 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

                            {/* Financeiro */}
                            <DetailCard title="Financeiro" icon={<DollarSign className="h-4 w-4" />}>
                              <DRow label="Preço atual"   value={BRL(a.currentPrice)} />
                              <DRow label="Custo"         value={a.cost > 0 ? BRL(a.cost) : "não cadastrado"} warn={a.cost === 0} />
                              <DRow label="Margem real"   value={a.marginStatus === "nocost" ? "—" : `${a.margin.toFixed(1)}%`}
                                color={a.margin < 0 ? "red" : a.marginStatus === "ok" ? "green" : "yellow"} />
                              <DRow label="Lucro/unidade" value={a.marginStatus === "nocost" ? "—" : BRL(a.lucro)}
                                color={a.lucro < 0 ? "red" : "green"} />
                              <DRow label="Preço ideal"   value={a.idealPrice > 0 ? BRL(a.idealPrice) : "—"} />
                            </DetailCard>

                            {/* Performance */}
                            <DetailCard title="Performance (90d)" icon={<TrendingUp className="h-4 w-4" />}>
                              <DRow label="Visitas"     value={a.visits.toLocaleString("pt-BR")} />
                              <DRow label="Vendidos"    value={String(a.sold)} />
                              <DRow label="Faturamento" value={BRL(a.revenue)} />
                              <DRow label="Conversão"   value={`${a.conversion.toFixed(2)}%`}
                                color={a.conversion >= 3 ? "green" : a.conversion >= 1 ? "yellow" : "red"} />
                              <DRow label="Curva ABC"   value={a.abcClass}
                                color={a.abcClass === "A" ? "green" : a.abcClass === "B" ? "yellow" : "red"} />
                            </DetailCard>

                            {/* Benchmark */}
                            <DetailCard title="Benchmark de preço" icon={<BarChart2 className="h-4 w-4" />}>
                              {a.benchmark ? (<>
                                <DRow label="Seu preço"     value={BRL(a.currentPrice)} />
                                <DRow label="Menor preço"   value={BRL(a.benchmark.lowest_price)} />
                                <DRow label="Preço sugerido" value={BRL(a.benchmark.suggested_price)} />
                                <DRow label="Diferença"     value={`${a.benchmark.percent_difference >= 0 ? "+" : ""}${a.benchmark.percent_difference.toFixed(1)}%`}
                                  color={a.benchmark.percent_difference >= 0 ? "green" : a.benchmark.percent_difference >= -10 ? "yellow" : "red"} />
                                <DRow label="Taxa ML"       value={BRL(a.benchmark.selling_fees)} />
                              </>) : <p className="text-xs text-muted-foreground">Não disponível para este anúncio</p>}
                            </DetailCard>

                            {/* Anúncio */}
                            <DetailCard title="Saúde do anúncio" icon={<Shield className="h-4 w-4" />}>
                              <DRow label="Tipo" value={TYPE_LABEL[a.listing_type_id] || a.listing_type_id} />
                              <DRow label="ID ML" value={a.mlItemId} />
                              {a.health && <DRow label="Health status" value={a.health.status} />}
                              <DRow label="Perguntas total"  value={String(a.questions.total)} />
                              <DRow label="Sem resposta"     value={String(a.questions.unanswered)}
                                color={a.questions.unanswered > 0 ? "red" : "green"}
                                warn={a.questions.unanswered > 0} />
                              {a.alerts.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {a.alerts.map((al, i) => (
                                    <div key={i} className="flex items-center gap-1.5 text-xs text-red-700">
                                      <AlertTriangle className="h-3 w-3 shrink-0" />
                                      {al}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </DetailCard>

                          </div>
                        </td>
                      </tr>
                    )}
                  </>)
                })}

                {filtered.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-10 text-center text-muted-foreground">
                    Nenhum anúncio encontrado.
                  </td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </>)}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: "green"|"red" }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-lg font-bold leading-tight ${color === "green" ? "text-green-700" : color === "red" ? "text-red-700" : ""}`}>
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function RepMetric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg ${warn ? "bg-red-50 border border-red-200" : "bg-muted/50"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-base font-bold ${warn ? "text-red-600" : ""}`}>{value}</div>
    </div>
  )
}

function DetailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-muted/30 border border-border rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2.5">
        {icon}{title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DRow({ label, value, color, warn }: { label: string; value: string; color?: "green"|"red"|"yellow"; warn?: boolean }) {
  const cls = color === "green" ? "text-green-700 font-semibold"
    : color === "red" ? "text-red-700 font-semibold"
    : color === "yellow" ? "text-yellow-700 font-semibold"
    : "text-foreground"
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right truncate ${cls}`}>{value}</span>
    </div>
  )
}
