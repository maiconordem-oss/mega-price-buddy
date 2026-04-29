import { useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BRL } from "@/services/ml-api"
import { useProducts } from "@/contexts/ProductsContext"
import { useAnalytics, filterOrdersByDays, buildOrderMap } from "@/contexts/AnalyticsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { Loader2, RefreshCw, Clock, Star } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts"

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
  visits:    number
  conversion: number        // qty / visits * 100

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
  const [showOnly, setShowOnly] = useState<"all" | "estrela">("all")

  useShopReset(useCallback(() => { setDays(30); setShowOnly("all") }, []))

  const filteredOrders = useMemo(() => filterOrdersByDays(allOrders, days), [allOrders, days])
  const orderMap       = useMemo(() => buildOrderMap(filteredOrders), [filteredOrders])

  // ── Classificação completa ────────────────────────────────────────────────
  const allItems = useMemo((): AbcItem[] => {
    const mlItems = products.filter(p => p.mlItemId)

    // Dados base
    const base = mlItems.map(p => ({
      sku:       p.sku,
      name:      p.name,
      mlItemId:  p.mlItemId!,
      image:     p.image,
      revenue:   orderMap[p.mlItemId!]?.revenue || 0,
      qty:       orderMap[p.mlItemId!]?.qty || 0,
      visits:    visitMap[p.mlItemId!] || 0,
      conversion: (() => {
        const v = visitMap[p.mlItemId!] || 0
        const q = orderMap[p.mlItemId!]?.qty || 0
        return v > 0 ? (q / v) * 100 : 0
      })(),
    }))

    const totalRevenue = base.reduce((s, x) => s + x.revenue, 0)
    const avgConversion = (() => {
      const withVisits = base.filter(x => x.visits > 0)
      return withVisits.length > 0
        ? withVisits.reduce((s, x) => s + x.conversion, 0) / withVisits.length
        : 0
    })()

    // ABC por faturamento (ordenado por revenue desc)
    const byRevenue = [...base].sort((a, b) => b.revenue - a.revenue)
    const mapRevenue = classificarABC(byRevenue.map(x => ({ id: x.mlItemId, valor: x.revenue })))

    // ABC por quantidade (ordenado por qty desc)
    const byQty = [...base].sort((a, b) => b.qty - a.qty)
    const mapQty = classificarABC(byQty.map(x => ({ id: x.mlItemId, valor: x.qty })))

    // ABC por visitas (ordenado por visits desc)
    const byVisits = [...base].sort((a, b) => b.visits - a.visits)
    const mapVisits = classificarABC(byVisits.map(x => ({ id: x.mlItemId, valor: x.visits })))

    // Montar objetos completos
    const withAbc = base.map(p => {
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
      }
    })

    // Calcular estrela
    return withAbc.map(p => {
      const { isEstrela, estrelScore } = calcularEstrela(p, avgConversion, totalRevenue)
      return { ...p, isEstrela, estrelScore }
    })
  }, [products, orderMap, visitMap])

  // ── Tabela ordenada pela dimensão ativa ───────────────────────────────────
  const tableItems = useMemo(() => {
    const sorted = [...allItems].sort((a, b) =>
      mode === "revenue" ? b.revenue - a.revenue :
      mode === "qty"     ? b.qty - a.qty :
                           b.visits - a.visits
    )
    return showOnly === "estrela" ? sorted.filter(x => x.isEstrela) : sorted
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
    A: allItems.filter(x => getAbc(x) === "A").length,
    B: allItems.filter(x => getAbc(x) === "B").length,
    C: allItems.filter(x => getAbc(x) === "C").length,
    estrela: allItems.filter(x => x.isEstrela).length,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["A", "B", "C"] as AbcClass[]).map(l => (
          <Card key={l} className={`cursor-pointer transition-all ${showOnly === "all" ? "" : "opacity-70"}`}
            onClick={() => setShowOnly("all")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center font-black text-base text-white shrink-0"
                style={{ background: ABC_COLORS[l] }}>{l}</div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {l === "A" ? `0–80% ${modeLabel}` : l === "B" ? `80–95% ${modeLabel}` : `95–100%`}
                </div>
                <div className="text-xl font-bold">{counts[l]}</div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Card Estrela */}
        <Card
          className={`cursor-pointer transition-all border-2 ${showOnly === "estrela" ? "border-[#2D3277]" : "border-transparent"}`}
          onClick={() => setShowOnly(v => v === "estrela" ? "all" : "estrela")}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "#FFE600" }}>
              <Star className="h-5 w-5 fill-[#2D3277] text-[#2D3277]" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Produto Estrela</div>
              <div className="text-xl font-bold text-[#2D3277]">{counts.estrela}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legenda estrela */}
      <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-medium text-foreground">⭐ Produto Estrela:</span>
        <span>Classe A em pelo menos 2 das 3 métricas</span>
        <span>(faturamento, quantidade, visitas)</span>
      </div>

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
              {showOnly === "estrela" ? "⭐ Produtos Estrela" : `Curva ABC — ${modeLabel}`}
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
                    {modeLabel} ↓
                  </th>
                  <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">% Acum.</th>
                  {mode !== "revenue" && <th className="text-right font-medium px-3 py-2.5">Faturamento</th>}
                  {mode !== "qty"     && <th className="text-right font-medium px-3 py-2.5">Qtd</th>}
                  {mode !== "visits"  && <th className="text-right font-medium px-3 py-2.5">Visitas</th>}
                  <th className="text-right font-medium px-3 py-2.5">Conversão</th>
                  <th className="text-right font-medium px-3 py-2.5">ABC Fat.</th>
                  <th className="text-right font-medium px-3 py-2.5">ABC Qtd</th>
                  <th className="text-right font-medium px-3 py-2.5">ABC Visit.</th>
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
                      className={`border-t hover:bg-muted/30 ${item.isEstrela ? "bg-[#E8EDFF]/30" : ""} ${isLastA || isLastB ? "border-b-2 border-dashed border-muted-foreground/30" : ""}`}
                    >
                      {/* Curva ativa */}
                      <td className="px-3 py-2">
                        <Badge
                          className="font-bold border-0 text-white text-xs"
                          style={{ background: ABC_COLORS[abc] }}
                        >
                          {abc}
                        </Badge>
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
                            </div>
                            {/* SKU + MLB + link */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                              {item.sku && item.sku !== item.mlItemId && (
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground font-mono flex items-center gap-0.5"
                                  title="Copiar SKU"
                                  onClick={() => { navigator.clipboard.writeText(item.sku); }}
                                >
                                  SKU:{item.sku.length > 12 ? item.sku.slice(0, 12) + "…" : item.sku}
                                </button>
                              )}
                              <button
                                className="text-xs text-[#2D3277] hover:text-[#1e2456] font-mono flex items-center gap-0.5"
                                title="Copiar MLB"
                                onClick={() => { navigator.clipboard.writeText(item.mlItemId); }}
                              >
                                {item.mlItemId}
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
                          {item.visits > 0 ? item.conversion.toFixed(1) + "%" : "—"}
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
