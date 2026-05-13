import { useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BRL } from "@/services/ml-api"
import { useProducts } from "@/contexts/ProductsContext"
import { useAnalytics, filterOrdersByDays, buildOrderMap } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { Loader2, RefreshCw, Clock, Star, Copy, Check, PackageX } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts"
import { toast } from "sonner"

// ── Tipos ─────────────────────────────────────────────────────────────────────

type AbcClass  = "A" | "B" | "C"
type Mode      = "revenue" | "qty" | "visits"

interface AbcItem {
  sku:       string
  name:      string
  mlItemId:  string
  image:     string
  revenue:   number
  qty:       number
  visits:    number     // escalado para o período (estimativa quando days < 90)
  visits90d: number     // dado bruto da API (sempre 90 dias)
  conversion: number    // qty / visits * 100

  // ABC por cada dimensão (calculado independentemente)
  abcRevenue: AbcClass
  abcQty:     AbcClass
  abcVisits:  AbcClass

  // percentual acumulado por dimensão (para tabela)
  pctAccRevenue: number
  pctAccQty:     number
  pctAccVisits:  number

  // estrela
  isEstrela: boolean
  estrelScore: number       // 0-100
  noData?: boolean

  // reposição: sem estoque mas vendeu no período
  needsRestock: boolean
}

// ── Constantes ────────────────────────────────────────────────────────────────

const ABC_COLORS: Record<AbcClass, string> = {
  A: "#1a7a45",
  B: "#8a5c00",
  C: "#c0392b",
}

const ESTRELA_COLOR = "#2D3277"

const CORTES = { A: 0.80, B: 0.95 } // 0-80% = A, 80-95% = B, >95% = C

// ── Função de classificação ABC ───────────────────────────────────────────────
// Recebe lista de itens com valor numérico já ordenada do maior para o menor.
// Retorna array com abc e percentual acumulado por item.

function classificarABC(
  items: { id: string; valor: number }[]
): Map<string, { abc: AbcClass; pctAcc: number }> {
  const total = items.reduce((s, x) => s + x.valor, 0)
  const result = new Map<string, { abc: AbcClass; pctAcc: number }>()
  let acc = 0

  for (const item of items) {
    acc += item.valor
    const pctAcc = total > 0 ? acc / total : 1
    const abc: AbcClass =
      pctAcc <= CORTES.A ? "A" :
      pctAcc <= CORTES.B ? "B" : "C"
    result.set(item.id, { abc, pctAcc })
  }

  return result
}

// ── Regra Produto Estrela ─────────────────────────────────────────────────────
// Um produto é ESTRELA quando:
//   - É curva A em faturamento  (responsável pelos primeiros 70% da receita)
//   - É curva A ou B em quantidade  (está entre os 90% maiores em unidades)
//   - Conversão acima da média geral (mais eficiente do que a média)
//
// Score estrela (0-100):
//   40 pts → ABC faturamento = A
//   20 pts → ABC quantidade  = A (10 pts se B)
//   20 pts → conversão ≥ 2x a média geral
//   10 pts → ABC visitas = A
//   10 pts → faturamento individual ≥ 2% do total

function calcularEstrela(
  item: Omit<AbcItem, "isEstrela" | "estrelScore">,
  _avgConversion: number,
  _totalRevenue: number,
): { isEstrela: boolean; estrelScore: number } {
  // Conta quantas métricas são Classe A
  const classesA = [item.abcRevenue, item.abcQty, item.abcVisits].filter(c => c === "A").length

  // Produto Estrela = Classe A em pelo menos 2 das 3 métricas
  const isEstrela = classesA >= 2

  // Score: 0-100 proporcional ao número de A's (para exibição)
  const score = Math.round((classesA / 3) * 100)

  return { isEstrela, estrelScore: score }
}

// ── Componente ────────────────────────────────────────────────────────────────

export function CurvaAbcTab() {
  const { products } = useProducts()
  const { visitMap, allOrders, loading, loaded, lastFetch, load } = useAnalytics()
  const [days, setDays]   = useState(30)
  const [mode, setMode]   = useState<Mode>("revenue")
  const [showOnly, setShowOnly] = useState<"all" | "estrela" | "repor">("all")
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = useCallback((text: string, label: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    toast.success(`${label} copiado!`, { duration: 1500 })
    setTimeout(() => setCopied(null), 2000)
  }, [])

  useShopReset(useCallback(() => { setDays(30); setShowOnly("all") }, []))

  const filteredOrders = useMemo(() => filterOrdersByDays(allOrders, days), [allOrders, days])
  const orderMap       = useMemo(() => buildOrderMap(filteredOrders), [filteredOrders])

  // Fix bug 1: visitas são sempre 90d na API — avisa o usuário quando o período não bate
  const isApproxVisits = days < 90

  // ── Classificação completa ────────────────────────────────────────────────
  const allItems = useMemo((): AbcItem[] => {
    // Fix duplicatas: mesmo mlItemId pode aparecer mais de uma vez no array
    // de produtos (cache + refresh em paralelo, ou dois anúncios com mesmo SKU)
    const seen = new Set<string>()
    const mlItems = products
      .filter(p => p.mlItemId)
      .filter(p => { if (seen.has(p.mlItemId!)) return false; seen.add(p.mlItemId!); return true })

    // Visitas são sempre de 90 dias (limitação da API ML).
    // Quando days < 90, escalamos proporcionalmente como estimativa.
    const visitScale = days < 90 ? days / 90 : 1

    // Dados base
    const base = mlItems.map(p => ({
      sku:       p.sku,
      name:      p.name,
      mlItemId:  p.mlItemId!,
      image:     p.image,
      available_quantity: (p as any).available_quantity as number ?? -1,
      status:    (p as any).status as string ?? 'active',
      revenue:   orderMap[p.mlItemId!]?.revenue || 0,
      qty:       orderMap[p.mlItemId!]?.qty || 0,
      // visits90d: dado bruto da API (sempre 90 dias)
      visits90d: visitMap[p.mlItemId!] || 0,
      // visits: escalado para o período selecionado (estimativa quando days < 90)
      visits:    Math.round((visitMap[p.mlItemId!] || 0) * visitScale),
      conversion: (() => {
        const v90 = visitMap[p.mlItemId!] || 0
        const q   = orderMap[p.mlItemId!]?.qty || 0
        // Conversão = vendas do período / visitas estimadas do período
        const vPeriod = Math.max(v90 * visitScale, 1)
        return v90 > 0 ? (q / vPeriod) * 100 : 0
      })(),
    }))

    // Fix bug 2: "tem dados" = teve vendas no período.
    // Visitas de 90d não entram no critério quando days < 90 —
    // não sabemos se as visitas foram no período selecionado ou antes.
    const comDados = days === 90
      ? base.filter(p => p.revenue > 0 || p.qty > 0 || p.visits90d > 0)
      : base.filter(p => p.revenue > 0 || p.qty > 0)

    const semDados = base.filter(p => !comDados.includes(p))

    const totalRevenue  = comDados.reduce((s, x) => s + x.revenue, 0)
    const avgConversion = (() => {
      const withVisits = comDados.filter(x => x.visits > 0)
      return withVisits.length > 0
        ? withVisits.reduce((s, x) => s + x.conversion, 0) / withVisits.length
        : 0
    })()

    // ABC calculado APENAS nos produtos com dados
    const byRevenue = [...comDados].sort((a, b) => b.revenue - a.revenue)
    const mapRevenue = classificarABC(byRevenue.map(x => ({ id: x.mlItemId, valor: x.revenue })))

    const byQty = [...comDados].sort((a, b) => b.qty - a.qty)
    const mapQty = classificarABC(byQty.map(x => ({ id: x.mlItemId, valor: x.qty })))

    const byVisits = [...comDados].sort((a, b) => b.visits - a.visits)
    const mapVisits = classificarABC(byVisits.map(x => ({ id: x.mlItemId, valor: x.visits })))

    // Produtos COM dados — têm classificação ABC real
    const withAbc = comDados.map(p => {
      const rr = mapRevenue.get(p.mlItemId) || { abc: "C" as AbcClass, pctAcc: 1 }
      const rq = mapQty.get(p.mlItemId)     || { abc: "C" as AbcClass, pctAcc: 1 }
      const rv = mapVisits.get(p.mlItemId)  || { abc: "C" as AbcClass, pctAcc: 1 }
      return {
        ...p,
        abcRevenue:    rr.abc,
        abcQty:        rq.abc,
        abcVisits:     rv.abc,
        pctAccRevenue: rr.pctAcc,
        pctAccQty:     rq.pctAcc,
        pctAccVisits:  rv.pctAcc,
        // Vendeu no período mas está sem estoque → precisa repor
        needsRestock: p.available_quantity === 0 && p.qty > 0,
      }
    })

    // Produtos SEM dados — classificados como "C" mas marcados como sem atividade
    const withoutAbc = semDados.map(p => ({
      ...p,
      abcRevenue:    "C" as AbcClass,
      abcQty:        "C" as AbcClass,
      abcVisits:     "C" as AbcClass,
      pctAccRevenue: 1,
      pctAccQty:     1,
      pctAccVisits:  1,
      noData: true,  // flag para UI diferenciar
      needsRestock: false,
    }))

    // Combina: com dados primeiro (ordenados pelo ABC), sem dados por último
    const all = [...withAbc, ...withoutAbc]

    // Calcular estrela (só produtos com dados)
    return all.map(p => {
      const { isEstrela, estrelScore } = calcularEstrela(p, avgConversion, totalRevenue)
      return { ...p, isEstrela, estrelScore, needsRestock: p.needsRestock ?? false }
    })
  }, [products, orderMap, visitMap])

  // Ordem numérica das classes ABC para ordenação
  const ABC_ORDER: Record<AbcClass, number> = { A: 0, B: 1, C: 2 }

  // ── Tabela ordenada: A → B → C sempre, depois métrica dentro do grupo ────
  const tableItems = useMemo(() => {
    const abcOf = (x: AbcItem): AbcClass =>
      mode === "revenue" ? x.abcRevenue : mode === "qty" ? x.abcQty : x.abcVisits
    const valOf = (x: AbcItem): number =>
      mode === "revenue" ? x.revenue : mode === "qty" ? x.qty : x.visits

    const sorted = [...allItems].sort((a, b) => {
      // 1. sem dados vai pro fim sempre
      if (a.noData !== b.noData) return a.noData ? 1 : -1
      // 2. A antes de B antes de C
      const abcDiff = ABC_ORDER[abcOf(a)] - ABC_ORDER[abcOf(b)]
      if (abcDiff !== 0) return abcDiff
      // 3. dentro do mesmo grupo: itens que precisam repor sobem
      if (a.needsRestock !== b.needsRestock) return a.needsRestock ? -1 : 1
      // 4. dentro do mesmo grupo: maior valor primeiro
      return valOf(b) - valOf(a)
    })

    if (showOnly === "estrela") return sorted.filter(x => x.isEstrela)
    if (showOnly === "repor")   return sorted.filter(x => x.needsRestock)
    return sorted
  }, [allItems, mode, showOnly])

  // ABC ativo por dimensão
  const getAbc  = (item: AbcItem): AbcClass =>
    mode === "revenue" ? item.abcRevenue :
    mode === "qty"     ? item.abcQty     : item.abcVisits

  const getPct  = (item: AbcItem): number =>
    mode === "revenue" ? item.pctAccRevenue :
    mode === "qty"     ? item.pctAccQty     : item.pctAccVisits

  const getVal  = (item: AbcItem): number =>
    mode === "revenue" ? item.revenue :
    mode === "qty"     ? item.qty     : item.visits

  // Totais para a dimensão ativa
  const totalAtivo = tableItems.reduce((s, x) => s + getVal(x), 0)

  // Contagens por curva (dimensão ativa)
  const counts = useMemo(() => ({
    A: allItems.filter(x => !x.noData && getAbc(x) === "A").length,
    B: allItems.filter(x => !x.noData && getAbc(x) === "B").length,
    C: allItems.filter(x => !x.noData && getAbc(x) === "C").length,
    estrela: allItems.filter(x => x.isEstrela).length,
    repor:   allItems.filter(x => x.needsRestock).length,
    semDados: allItems.filter(x => x.noData).length,
  }), [allItems, mode])

  // Gráfico: top 20 ordenados pela dimensão ativa
  const chartData = useMemo(() =>
    [...allItems]
      .sort((a, b) => getVal(b) - getVal(a))
      .slice(0, 20)
      .map(d => ({
        name:  d.name.length > 18 ? d.name.slice(0, 18) + "…" : d.name,
        value: getVal(d),
        abc:   getAbc(d),
        isEstrela: d.isEstrela,
      }))
  , [allItems, mode])

  // ── Render ────────────────────────────────────────────────────────────────

  const modeLabel = mode === "revenue" ? "Faturamento" : mode === "qty" ? "Quantidade" : "Visitas"
  const modeUnit  = mode === "revenue" ? "" : mode === "qty" ? " un." : " visitas"

  return (
    <div className="space-y-5">

      {/* ── Cards de resumo ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {(["A", "B", "C"] as AbcClass[]).map(l => (
          <Card key={l} className="cursor-pointer" onClick={() => setShowOnly("all")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center font-black text-base text-white shrink-0"
                style={{ background: ABC_COLORS[l] }}>{l}</div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {l === "A" ? `0–80% ${modeLabel}` : l === "B" ? `80–95%` : `95–100%`}
                </div>
                <div className="text-xl font-bold">{counts[l]}</div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Estrela */}
        <Card className={`cursor-pointer transition-all border-2 ${showOnly === "estrela" ? "border-[#2D3277]" : "border-transparent"}`}
          onClick={() => setShowOnly(v => v === "estrela" ? "all" : "estrela")}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#FFE600" }}>
              <Star className="h-5 w-5 fill-[#2D3277] text-[#2D3277]" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Estrela</div>
              <div className="text-xl font-bold text-[#2D3277]">{counts.estrela}</div>
            </div>
          </CardContent>
        </Card>

        {/* Repor Urgente */}
        {counts.repor > 0 && (
          <Card
            className={`cursor-pointer transition-all border-2 ${showOnly === "repor" ? "border-orange-500" : "border-transparent"}`}
            onClick={() => setShowOnly(v => v === "repor" ? "all" : "repor")}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-orange-500">
                <PackageX className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Repor</div>
                <div className="text-xl font-bold text-orange-600">{counts.repor}</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sem dados */}
        {counts.semDados > 0 && (
          <Card className="opacity-60">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0 text-xs font-bold text-muted-foreground">—</div>
              <div>
                <div className="text-xs text-muted-foreground">Sem atividade</div>
                <div className="text-xl font-bold text-muted-foreground">{counts.semDados}</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Legendas */}
      <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-medium text-foreground">⭐ Produto Estrela:</span> Classe A em pelo menos 2 das 3 métricas (faturamento, quantidade, visitas)</span>
        <span><span className="font-medium text-orange-600">📦 Repor:</span> Vendeu no período mas está sem estoque — comprar agora</span>
      </div>

      {/* Aviso de visitas aproximadas */}
      {isApproxVisits && loaded && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <span>
            <span className="font-semibold">Visitas aproximadas:</span> a API do Mercado Livre retorna visitas acumuladas de 90 dias —
            não é possível filtrar por período menor. Para o período de <span className="font-semibold">{days} dias</span>,
            as visitas e a conversão são <span className="font-semibold">estimativas proporcionais</span> (÷ {Math.round(90 / days)}×).
            Use <span className="font-semibold">90 dias</span> para dados exatos de visitas.
          </span>
        </div>
      )}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={days}
          onChange={e => setDays(+e.target.value)}>
          {[7, 30, 60, 90].map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
        </select>

        <div className="flex rounded-md border overflow-hidden">
          {(["revenue", "qty", "visits"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {m === "revenue" ? "Faturamento" : m === "qty" ? "Quantidade" : "Visitas"}
            </button>
          ))}
        </div>

        {showOnly === "estrela" && (
          <Badge className="bg-[#2D3277]/10 text-[#2D3277] border-0">
            ⭐ Filtrando Estrelas
          </Badge>
        )}

        {showOnly === "repor" && (
          <Badge className="bg-orange-100 text-orange-700 border-0">
            📦 Filtrando: Repor Urgente
          </Badge>
        )}

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

      {/* ── Gráfico ──────────────────────────────────────────────────────── */}
      {loaded && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Top 20 por {modeLabel.toLowerCase()}
              <span className="text-muted-foreground font-normal ml-2 text-xs">
                (ordenado pela dimensão selecionada · ⭐ = Estrela)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 70 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-40}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={v =>
                    mode === "revenue"
                      ? `R$${(v / 1000).toFixed(0)}k`
                      : v.toLocaleString("pt-BR")
                  }
                />
                <Tooltip
                  formatter={(v: number) =>
                    mode === "revenue"
                      ? BRL(v)
                      : `${v.toLocaleString("pt-BR")}${modeUnit}`
                  }
                />
                <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.isEstrela ? ESTRELA_COLOR : ABC_COLORS[d.abc]}
                      stroke={d.isEstrela ? "#FFE600" : "none"}
                      strokeWidth={d.isEstrela ? 2 : 0}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Estados vazios / loading ──────────────────────────────────────── */}
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

      {/* ── Tabela ───────────────────────────────────────────────────────── */}
      {loaded && (
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {showOnly === "estrela" ? "⭐ Produtos Estrela" : showOnly === "repor" ? "📦 Repor Urgente" : `Curva ABC — ${modeLabel}`}
              <span className="text-muted-foreground font-normal text-xs ml-2">
                {tableItems.length} produtos · ordenado por {modeLabel.toLowerCase()}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2.5">Curva</th>
                  <th className="text-left font-medium px-3 py-2.5">Produto</th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                    {modeLabel}{isApproxVisits && mode === "visits" && <span className="text-amber-500 ml-0.5" title="Estimativa proporcional de 90 dias">~</span>} ↓
                  </th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">% Acum.</th>
                  {mode !== "revenue" && <th className="text-right font-medium px-3 py-2.5">Faturamento</th>}
                  {mode !== "qty"     && <th className="text-right font-medium px-3 py-2.5">Qtd</th>}
                  {mode !== "visits"  && (
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                      Visitas{isApproxVisits && <span className="text-amber-500 ml-0.5" title="Estimativa proporcional de 90 dias">~</span>}
                    </th>
                  )}
                  <th className="text-right font-medium px-3 py-2.5">Conversão</th>
                  <th className="text-right font-medium px-3 py-2.5">ABC Fat.</th>
                  <th className="text-right font-medium px-3 py-2.5">ABC Qtd</th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">
                    ABC Visit.{isApproxVisits && <span className="text-amber-500 ml-0.5" title="Estimativa proporcional — visitas sempre de 90 dias">~</span>}
                  </th>
                  <th className="text-center font-medium px-3 py-2.5">⭐</th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item) => {
                  const abc    = getAbc(item)
                  const pctAcc = getPct(item)
                  const val    = getVal(item)
                  // Linha de corte visual
                  const isLastA = abc === "A" && (
                    mode === "revenue" ? item.pctAccRevenue > CORTES.A :
                    mode === "qty"     ? item.pctAccQty > CORTES.A :
                                         item.pctAccVisits > CORTES.A
                  )
                  const isLastB = abc === "B" && (
                    mode === "revenue" ? item.pctAccRevenue > CORTES.B :
                    mode === "qty"     ? item.pctAccQty > CORTES.B :
                                         item.pctAccVisits > CORTES.B
                  )

                  return (
                    <tr
                      key={item.mlItemId}
                      className={`border-t hover:bg-muted/30
                        ${item.needsRestock ? "bg-orange-50/60 dark:bg-orange-950/20" : item.isEstrela ? "bg-[#E8EDFF]/30" : ""}
                        ${isLastA || isLastB ? "border-b-2 border-dashed border-muted-foreground/30" : ""}
                      `}
                      style={item.needsRestock ? { boxShadow: "inset 3px 0 0 #f97316" } : undefined}
                    >
                      {/* Curva ativa */}
                      <td className="px-3 py-2">
                        {item.noData ? (
                          <span className="text-xs text-muted-foreground italic">sem dados</span>
                        ) : (
                          <Badge
                            className="font-bold border-0 text-white text-xs"
                            style={{ background: ABC_COLORS[abc] }}
                          >
                            {abc}
                          </Badge>
                        )}
                      </td>

                      {/* Nome + SKU + MLB + link */}
                      <td className="px-3 py-2" style={{ minWidth: "220px", maxWidth: "280px" }}>
                        <div className="flex items-start gap-2">
                          <img
                            src={item.image} alt=""
                            className="h-8 w-8 rounded object-cover bg-muted shrink-0 mt-0.5"
                            onError={e => { (e.target as HTMLImageElement).style.display = "none" }}
                          />
                          <div className="min-w-0 flex-1">
                            {/* Título */}
                            <div className="font-medium text-xs leading-snug line-clamp-2" title={item.name}>
                              {item.name}
                              {item.needsRestock && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-orange-500 text-white">
                                  <PackageX className="h-2.5 w-2.5" />
                                  REPOR
                                </span>
                              )}
                              {!item.needsRestock && (item as any).available_quantity === 0 && (
                                <span className="ml-1.5 inline-flex items-center px-1 py-0 rounded text-[9px] font-bold bg-orange-100 text-orange-700">
                                  sem estoque
                                </span>
                              )}
                            </div>
                            {/* SKU + MLB + link */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                              {item.sku && item.sku !== item.mlItemId && (
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground font-mono flex items-center gap-0.5 transition-colors"
                                  title="Copiar SKU"
                                  onClick={() => copyToClipboard(item.sku, "SKU", `sku-${item.mlItemId}`)}
                                >
                                  {copied === `sku-${item.mlItemId}`
                                    ? <Check className="h-3 w-3 text-green-600 shrink-0" />
                                    : <Copy className="h-3 w-3 shrink-0 opacity-50" />}
                                  <span>{item.sku.length > 14 ? item.sku.slice(0, 14) + "…" : item.sku}</span>
                                </button>
                              )}
                              <button
                                className="text-xs text-[#2D3277] hover:text-[#1e2456] font-mono flex items-center gap-0.5 transition-colors"
                                title="Copiar MLB"
                                onClick={() => copyToClipboard(item.mlItemId, "MLB", `mlb-${item.mlItemId}`)}
                              >
                                {copied === `mlb-${item.mlItemId}`
                                  ? <Check className="h-3 w-3 text-green-600 shrink-0" />
                                  : <Copy className="h-3 w-3 shrink-0 opacity-50" />}
                                <span>{item.mlItemId}</span>
                              </button>
                              <a
                                href={`https://produto.mercadolivre.com.br/${item.mlItemId.replace("MLB", "MLB-")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-blue-500 hover:text-blue-700 underline"
                                title="Abrir no Mercado Livre"
                              >
                                ver ↗
                              </a>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Valor da dimensão ativa */}
                      <td className="px-3 py-2 text-right font-semibold">
                        {mode === "revenue"
                          ? BRL(val)
                          : val.toLocaleString("pt-BR") + modeUnit}
                      </td>

                      {/* % acumulado */}
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-mono ${
                          pctAcc <= CORTES.A ? "text-green-700" :
                          pctAcc <= CORTES.B ? "text-yellow-700" : "text-red-700"
                        }`}>
                          {(pctAcc * 100).toFixed(1)}%
                        </span>
                      </td>

                      {/* Colunas extras (as não-ativas) */}
                      {mode !== "revenue" && <td className="px-3 py-2 text-right">{BRL(item.revenue)}</td>}
                      {mode !== "qty"     && <td className="px-3 py-2 text-right font-mono">{item.qty}</td>}
                      {mode !== "visits"  && <td className="px-3 py-2 text-right font-mono">{item.visits.toLocaleString("pt-BR")}</td>}

                      {/* Conversão */}
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs ${
                          item.conversion >= 3 ? "text-green-700 font-semibold" :
                          item.conversion >= 1 ? "text-yellow-700" : "text-muted-foreground"
                        }`}>
                          {item.visits90d > 0
                            ? `${isApproxVisits ? "~" : ""}${item.conversion.toFixed(1)}%`
                            : "—"}
                        </span>
                      </td>

                      {/* ABC por cada dimensão */}
                      <td className="px-3 py-2 text-center">
                        <span className="font-bold text-xs" style={{ color: ABC_COLORS[item.abcRevenue] }}>
                          {item.abcRevenue}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-bold text-xs" style={{ color: ABC_COLORS[item.abcQty] }}>
                          {item.abcQty}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-bold text-xs" style={{ color: ABC_COLORS[item.abcVisits] }}>
                          {item.abcVisits}
                        </span>
                      </td>

                      {/* Estrela */}
                      <td className="px-3 py-2 text-center">
                        {item.isEstrela ? (
                          <span title={`Score estrela: ${item.estrelScore}/100`}>
                            <Star className="h-4 w-4 fill-[#FFE600] text-[#2D3277] mx-auto" />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">
                            {item.estrelScore}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}

                {tableItems.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                    {showOnly === "estrela"
                      ? "Nenhum Produto Estrela encontrado. Os critérios exigem curva A em faturamento, A/B em quantidade e conversão acima da média."
                      : showOnly === "repor"
                      ? "Nenhum produto precisa de reposição no período selecionado. Ótimo — o estoque está em dia!"
                      : "Nenhum produto encontrado."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
