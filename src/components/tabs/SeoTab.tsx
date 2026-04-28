import { useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useProducts } from "@/contexts/ProductsContext"
import { useShopReset } from "@/hooks/useShopReset"
import { BRL } from "@/services/ml-api"
import { toast } from "sonner"
import {
  Search, Loader2, ChevronDown, ChevronRight, Star, TrendingUp,
  Zap, FileText, ListChecks, BarChart2, Copy, Check, AlertTriangle,
  RefreshCw, Package,
} from "lucide-react"

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Competitor {
  position:     number
  title:        string
  price:        number
  stars:        number
  condition:    string
  brand:        string
  url:          string
  image:        string
  isSponsored:  boolean
  freeShipping: boolean
}

interface GeneratedTitle {
  text:     string
  chars:    number
  keywords: string[]
  strategy: string
  score:    number
  why:      string
}

interface SeoResult {
  keyword:      string
  product:      { id: string; name: string; currentTitle: string; price: number }
  competitors:  Competitor[]
  analysis:     string   // markdown da análise de ranking
  titles:       GeneratedTitle[]
  description:  string
  longtails:    string
  qa:           string
  report:       string
  generatedAt:  string
}

// ── Tabs do resultado ─────────────────────────────────────────────────────────

type ResultTab = "ranking" | "titles" | "description" | "longtails" | "qa" | "report"

const RESULT_TABS: { id: ResultTab; label: string; icon: React.ReactNode }[] = [
  { id: "ranking",     label: "Análise de Ranking",   icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { id: "titles",      label: "Títulos Otimizados",   icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "description", label: "Descrição",            icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "longtails",   label: "Keywords & Longtails", icon: <Search className="h-3.5 w-3.5" /> },
  { id: "qa",          label: "Q&A",                  icon: <ListChecks className="h-3.5 w-3.5" /> },
  { id: "report",      label: "Relatório Executivo",  icon: <TrendingUp className="h-3.5 w-3.5" /> },
]

// ── Componente principal ──────────────────────────────────────────────────────

export function SeoTab() {
  const { products } = useProducts()
  const mlProducts = products.filter(p => p.mlItemId)

  const [apifyToken,    setApifyToken]    = useState(() => localStorage.getItem("apify-token") || "")
  const [selectedId,    setSelectedId]    = useState("")
  const [keyword,       setKeyword]       = useState("")
  const [pages,         setPages]         = useState(2)
  const [loading,       setLoading]       = useState(false)
  const [loadingStep,   setLoadingStep]   = useState("")
  const [result,        setResult]        = useState<SeoResult | null>(null)
  const [activeTab,     setActiveTab]     = useState<ResultTab>("ranking")
  const [copied,        setCopied]        = useState<string | null>(null)
  const [expandComp,    setExpandComp]    = useState(false)

  useShopReset(useCallback(() => {
    setSelectedId(""); setKeyword(""); setResult(null)
  }, []))

  const selectedProduct = mlProducts.find(p => p.mlItemId === selectedId)

  // ── Salva token ───────────────────────────────────────────────────────────
  const saveToken = (t: string) => {
    setApifyToken(t)
    localStorage.setItem("apify-token", t)
  }

  // ── Copy helper ───────────────────────────────────────────────────────────
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  // ── Claude API call ───────────────────────────────────────────────────────
  const askClaude = async (prompt: string, maxTokens = 2000): Promise<string> => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    })
    const data = await res.json()
    const text = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || ""
    if (!text) throw new Error("Claude não retornou texto")
    return text
  }

  // ── Fluxo principal ───────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!apifyToken.trim()) { toast.error("Insira o token do Apify acima."); return }
    if (!selectedId)        { toast.error("Selecione um anúncio."); return }
    if (!keyword.trim())    { toast.error("Insira a keyword."); return }
    if (!selectedProduct)   return

    setLoading(true)
    setResult(null)

    try {
      // ── 1. Scraping via Apify ────────────────────────────────────────────
      setLoadingStep(`Buscando top ${pages * 60} resultados para "${keyword}"...`)

      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/karamelo~mercadolivre-scraper-brasil-portugues/run-sync-get-dataset-items?token=${apifyToken.trim()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: keyword.trim(), pages }),
        },
      )

      if (!apifyRes.ok) {
        const err = await apifyRes.json().catch(() => ({}))
        throw new Error(err.error?.message || `Apify HTTP ${apifyRes.status}`)
      }

      const rawItems: any[] = await apifyRes.json()
      if (!rawItems?.length) throw new Error("Apify não retornou resultados. Verifique a keyword.")

      const competitors: Competitor[] = rawItems.map((item, idx) => ({
        position:     idx + 1,
        title:        item.zProdutoNome || "",
        price:        parseFloat(String(item.zProdutoPrecoNovo || "0").replace(/[R$\s.]/g, "").replace(",", ".")) || 0,
        stars:        parseFloat(item.zProdutoEstrelas || "0") || 0,
        condition:    item.zProdutoCondicao || "novo",
        brand:        item.zProdutoMarca || "",
        url:          item.zProdutoLink || "",
        image:        item.zProdutoImagem || "",
        isSponsored:  !!(item.zProdutoLink?.includes("sponsored")),
        freeShipping: !!(item.freteGratis || item.freeShipping),
      }))

      const top20 = competitors.slice(0, 20)
      const competitorsJson = JSON.stringify(top20.map(c => ({
        pos: c.position, titulo: c.title, preco: c.price,
        estrelas: c.stars, frete_gratis: c.freeShipping,
        patrocinado: c.isSponsored, marca: c.brand,
      })), null, 2)

      const productJson = JSON.stringify({
        titulo_atual: selectedProduct.name,
        preco:        selectedProduct.listings.find(l => l.channel === "ml")?.currentPrice || 0,
        mlItemId:     selectedProduct.mlItemId,
      })

      // ── 2. Análise de ranking ────────────────────────────────────────────
      setLoadingStep("Analisando padrões de ranking...")
      const analysis = await askClaude(`
Você é especialista em SEO de marketplace brasileiro. Analise os dados dos TOP ${top20.length} produtos ranqueados para a keyword "${keyword}" no Mercado Livre Brasil.

DADOS DOS CONCORRENTES (JSON):
${competitorsJson}

PRODUTO DO VENDEDOR:
${productJson}

Faça análise completa em 6 seções:

## 1. PADRÕES DE TÍTULO
- Estrutura dominante (ex: "[Marca] + [Produto] + [Atributo]")
- Top 8 palavras-chave que aparecem em 50%+ dos títulos do top 10
- Comprimento médio dos títulos (mín, médio, máx em caracteres)
- Diferença entre posição 1-5 vs 6-20

## 2. ANÁLISE DE PREÇO E CONVERSÃO
- Preço mínimo, médio e máximo do top 10
- % com frete grátis
- Desconto médio exibido (DE/POR se disponível)

## 3. SOCIAL PROOF
- Nota média de estrelas top 5 vs geral
- Quantidade mínima de estrelas para aparecer no top 10

## 4. OPORTUNIDADES
- 3 pontos fracos dos top rankers exploráveis
- Score de dificuldade: FÁCIL | MÉDIO | DIFÍCIL | MUITO DIFÍCIL
- Top 3 quick wins (ações imediatas)

## 5. DIAGNÓSTICO DO ANÚNCIO ATUAL
- Gap vs top 3 (o que está faltando)
- Score atual: X/100 e score potencial após otimizações: X/100

## 6. KEYWORDS IDENTIFICADAS
- Liste as 10 principais keywords/longtails encontradas nos títulos dos top rankers

Responda em português brasileiro com dados concretos (%, médias). Seja direto e acionável.
`, 2000)

      // ── 3. Títulos otimizados ────────────────────────────────────────────
      setLoadingStep("Gerando títulos otimizados...")
      const titlesRaw = await askClaude(`
Com base na análise dos top rankers para "${keyword}" no Mercado Livre, gere 5 títulos otimizados para:

PRODUTO ATUAL: ${selectedProduct.name}
ID ML: ${selectedProduct.mlItemId}

PADRÕES IDENTIFICADOS:
${analysis.slice(0, 800)}

REGRAS OBRIGATÓRIAS:
- Máximo 60 caracteres (ideal 50-55)
- Keyword principal nos primeiros 30 caracteres
- Não usar: PROMOÇÃO, OFERTA, GRÁTIS, !!, ***
- Incluir atributos que mais aparecem nos top rankers

Para cada título forneça EXATAMENTE neste formato (sem markdown extra):
---
T�TULO: [texto]
CHARS: [número]
KEYWORDS: [kw1, kw2, kw3]
ESTRATÉGIA: [descrição curta]
SCORE: [0-100]
POR QUÊ: [1 linha explicando]
---
`, 1000)

      // Parse títulos
      const titleBlocks = titlesRaw.split("---").filter(b => b.includes("TÍTULO:"))
      const titles: GeneratedTitle[] = titleBlocks.map(block => {
        const get = (key: string) => {
          const match = block.match(new RegExp(`${key}:\\s*(.+)`))
          return match?.[1]?.trim() || ""
        }
        const text = get("TÍTULO")
        return {
          text,
          chars:    text.length,
          keywords: get("KEYWORDS").split(",").map(k => k.trim()).filter(Boolean),
          strategy: get("ESTRATÉGIA"),
          score:    parseInt(get("SCORE")) || 0,
          why:      get("POR QUÊ"),
        }
      }).filter(t => t.text.length > 0)

      // ── 4. Descrição ─────────────────────────────────────────────────────
      setLoadingStep("Gerando descrição otimizada...")
      const description = await askClaude(`
Crie uma descrição completa e otimizada para o Mercado Livre para o produto abaixo.

PRODUTO: ${selectedProduct.name}
KEYWORD PRINCIPAL: ${keyword}

KEYWORDS IDENTIFICADAS NOS TOP RANKERS:
${analysis.match(/## 6[\s\S]*?(?=##|$)/)?.[0] || ""}

A descrição deve conter:
**Parágrafo de abertura (2-3 linhas):** mencionar keyword principal + principal benefício
**Especificações (lista):** 6-8 bullet points "✓ Feature — Benefício"
**Para quem é:** 2-3 casos de uso
**Garantia e suporte:** política de devolução e suporte

Entre 800 e 1.500 caracteres. Responda com DUAS versões:
VERSION MARKDOWN:
[versão com formatação]

VERSION TEXTO PLANO:
[versão sem markdown, para copiar direto no ML]
`, 2000)

      // ── 5. Longtails ─────────────────────────────────────────────────────
      setLoadingStep("Extraindo longtails e keywords...")
      const titlesForLongtail = top20.map((c, i) => `${i+1}. ${c.title}`).join("\n")
      const longtails = await askClaude(`
Analise os títulos dos TOP ${top20.length} produtos para "${keyword}" e extraia estratégia de keywords.

T�TULOS DOS CONCORRENTES:
${titlesForLongtail}

Gere:
## LONGTAILS PRIMÁRIOS (alta intenção de compra)
20 termos de 2-4 palavras | volume: alto/médio/baixo | intenção: compra/pesquisa/comparação

## VARIAÇÕES SEMÂNTICAS
10 formas diferentes de buscar o mesmo produto

## ATRIBUTOS TÉCNICOS MAIS BUSCADOS
Características que aparecem nos títulos top rankers

## TERMOS DE AUTOCOMPLETE
Como compradores começam a digitar na busca

## TERMOS NEGATIVOS
Palavras que NÃO devem estar no título/descrição

## COMO DISTRIBUIR
- Título: quais usar
- Primeiros 100 chars da descrição: quais usar
- Atributos técnicos: quais usar

Responda em português com dados concretos.
`, 2000)

      // ── 6. Q&A ───────────────────────────────────────────────────────────
      setLoadingStep("Gerando Q&A otimizado...")
      const qa = await askClaude(`
Crie 8 pares de pergunta e resposta otimizados para SEO para o produto abaixo no Mercado Livre.

PRODUTO: ${selectedProduct.name}
KEYWORD: ${keyword}

Regras:
- Perguntas: dúvidas REAIS de compradores (técnicas, compatibilidade, uso, entrega, garantia)
- Respostas: máx 150 palavras, incluir keywords naturalmente, tom prestativo
- Variar os tipos de dúvida

Formato:
P1: [pergunta]
R1: [resposta]

P2: [pergunta]
R2: [resposta]

[continuar até P8/R8]

Responda em português brasileiro.
`, 1500)

      // ── 7. Relatório executivo ───────────────────────────────────────────
      setLoadingStep("Gerando relatório executivo...")
      const report = await askClaude(`
Gere um relatório executivo de 1 página baseado na análise para "${keyword}" no Mercado Livre.

ANÁLISE REALIZADA:
${analysis.slice(0, 1000)}

PRODUTO ANALISADO: ${selectedProduct.name}

O relatório deve conter:

## RESUMO EXECUTIVO
3-5 linhas: situação atual, principal problema, principal oportunidade.

## TOP 3 DESCOBERTAS
O que mais chama atenção nos dados.

## PLANO DE AÇÃO
| Ação | Impacto | Esforço | Prazo |
|------|---------|---------|-------|
[preencher com 5-7 ações concretas]

## MÉTRICAS PARA ACOMPANHAR
KPIs principais para os próximos 30 dias.

## PRÓXIMOS PASSOS
5 ações ordenadas por prioridade com prazo concreto.

Linguagem direta, sem rodeios, focada em resultado. Formato Markdown.
`, 1500)

      setResult({
        keyword:     keyword.trim(),
        product:     { id: selectedId, name: selectedProduct.name, currentTitle: selectedProduct.name, price: selectedProduct.listings.find(l => l.channel === "ml")?.currentPrice || 0 },
        competitors,
        analysis,
        titles,
        description,
        longtails,
        qa,
        report,
        generatedAt: new Date().toISOString(),
      })
      setActiveTab("ranking")
      toast.success(`Análise concluída — ${competitors.length} concorrentes analisados`)

    } catch (e) {
      toast.error("Erro: " + (e as Error).message)
    } finally {
      setLoading(false)
      setLoadingStep("")
    }
  }, [apifyToken, selectedId, keyword, pages, selectedProduct])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Config ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Análise SEO Competitiva
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Token Apify */}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Token Apify</label>
              <Input
                type="password"
                placeholder="apify_api_xxxxxxxxxxxx"
                value={apifyToken}
                onChange={e => saveToken(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <a href="https://console.apify.com/account/integrations" target="_blank" rel="noreferrer"
              className="h-9 px-3 text-xs border rounded-md flex items-center gap-1 hover:bg-muted whitespace-nowrap">
              Obter token ↗
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Anúncio */}
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Selecionar anúncio</label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              >
                <option value="">— escolha um anúncio —</option>
                {mlProducts.map(p => (
                  <option key={p.mlItemId} value={p.mlItemId!}>
                    {p.name.length > 50 ? p.name.slice(0, 50) + "…" : p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Keyword */}
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Keyword principal</label>
              <Input
                placeholder="ex: tênis masculino branco"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && run()}
              />
            </div>

            {/* Páginas */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Páginas de resultados (~{pages * 60} concorrentes)
              </label>
              <select
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={pages}
                onChange={e => setPages(+e.target.value)}
              >
                <option value={1}>1 página (~60)</option>
                <option value={2}>2 páginas (~120)</option>
                <option value={3}>3 páginas (~180)</option>
              </select>
            </div>
          </div>

          {/* Produto selecionado preview */}
          {selectedProduct && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#E8EDFF]/40 border border-[#2D3277]/20">
              <img src={selectedProduct.image} alt="" className="h-10 w-10 rounded-md object-cover bg-muted shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{selectedProduct.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedProduct.mlItemId}</div>
              </div>
              <div className="text-sm font-bold text-[#2D3277]">
                {BRL(selectedProduct.listings.find(l => l.channel === "ml")?.currentPrice || 0)}
              </div>
            </div>
          )}

          <Button
            className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456] font-semibold"
            onClick={run}
            disabled={loading || !selectedId || !keyword.trim() || !apifyToken.trim()}
          >
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{loadingStep}</>
              : <><Search className="h-4 w-4 mr-2" />Analisar concorrentes</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Estado vazio ───────────────────────────────────────────────────── */}
      {!result && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="font-medium">Selecione um anúncio e insira a keyword</p>
            <p className="text-sm mt-1">O Apify vai buscar os top concorrentes e a Claude vai analisar os padrões de ranking.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Resultado ──────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">

          {/* Header do resultado */}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <span className="text-sm text-muted-foreground">Keyword: </span>
              <span className="font-semibold">"{result.keyword}"</span>
            </div>
            <Badge className="bg-[#2D3277]/10 text-[#2D3277] border-0">
              {result.competitors.length} concorrentes analisados
            </Badge>
            <Badge className="bg-green-500/15 text-green-700 border-0">
              {result.competitors.filter(c => !c.isSponsored).length} orgânicos
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {new Date(result.generatedAt).toLocaleString("pt-BR")}
            </span>
            <Button size="sm" variant="outline" onClick={run} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refazer
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 flex-wrap border-b pb-0">
            {RESULT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? "border-[#2D3277] text-[#2D3277]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* Conteúdo das tabs */}

          {/* Ranking */}
          {activeTab === "ranking" && (
            <div className="space-y-4">
              <MarkdownCard content={result.analysis} onCopy={() => copy(result.analysis, "analysis")} copied={copied === "analysis"} />

              {/* Top concorrentes */}
              <Card>
                <CardHeader className="pb-2">
                  <button
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setExpandComp(v => !v)}
                  >
                    {expandComp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <CardTitle className="text-sm">
                      Top {Math.min(result.competitors.length, 20)} concorrentes coletados
                    </CardTitle>
                  </button>
                </CardHeader>
                {expandComp && (
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          {["#","Título","Preço","Estrelas","Frete","Tipo"].map(h => (
                            <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.competitors.slice(0, 20).map(c => (
                          <tr key={c.position} className="border-t hover:bg-muted/30">
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{c.position}</td>
                            <td className="px-3 py-1.5 max-w-[240px]">
                              <a href={c.url} target="_blank" rel="noreferrer"
                                className="truncate block hover:text-primary" title={c.title}>
                                {c.title}
                              </a>
                            </td>
                            <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{BRL(c.price)}</td>
                            <td className="px-3 py-1.5">
                              {c.stars > 0 ? (
                                <span className="flex items-center gap-1">
                                  <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                  {c.stars.toFixed(1)}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {c.freeShipping
                                ? <Badge className="bg-green-500/15 text-green-700 border-0 text-xs">Grátis</Badge>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </td>
                            <td className="px-3 py-1.5">
                              {c.isSponsored
                                ? <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs">Patrocinado</Badge>
                                : <Badge className="bg-blue-500/15 text-blue-700 border-0 text-xs">Orgânico</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                )}
              </Card>
            </div>
          )}

          {/* Títulos */}
          {activeTab === "titles" && (
            <div className="space-y-3">
              {result.titles.length === 0 && (
                <Card><CardContent className="py-8 text-center text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
                  Títulos não foram gerados corretamente. Tente refazer a análise.
                </CardContent></Card>
              )}
              {result.titles.map((t, i) => (
                <Card key={i} className={i === 0 ? "border-[#2D3277]/40 bg-[#E8EDFF]/20" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        {i === 0 && <Badge className="bg-[#2D3277] text-[#FFE600] border-0 text-xs">Recomendado</Badge>}
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          t.score >= 80 ? "bg-green-500/15 text-green-700"
                          : t.score >= 60 ? "bg-yellow-400/20 text-yellow-700"
                          : "bg-red-500/15 text-red-700"
                        }`}>Score {t.score}/100</span>
                        <span className="text-xs text-muted-foreground">{t.chars} chars</span>
                      </div>
                      <button
                        onClick={() => copy(t.text, `title-${i}`)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied === `title-${i}` ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied === `title-${i}` ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                    <p className="font-semibold text-base mb-2">{t.text}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {t.keywords.map(k => (
                        <span key={k} className="text-xs px-2 py-0.5 bg-muted rounded-full">{k}</span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Estratégia:</span> {t.strategy}
                    </div>
                    {t.why && (
                      <div className="text-xs text-muted-foreground mt-1">
                        <span className="font-medium text-foreground">Por que vai rankear:</span> {t.why}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Descrição */}
          {activeTab === "description" && (
            <MarkdownCard content={result.description} onCopy={() => copy(result.description, "desc")} copied={copied === "desc"} />
          )}

          {/* Longtails */}
          {activeTab === "longtails" && (
            <MarkdownCard content={result.longtails} onCopy={() => copy(result.longtails, "longtails")} copied={copied === "longtails"} />
          )}

          {/* Q&A */}
          {activeTab === "qa" && (
            <MarkdownCard content={result.qa} onCopy={() => copy(result.qa, "qa")} copied={copied === "qa"} />
          )}

          {/* Relatório */}
          {activeTab === "report" && (
            <MarkdownCard content={result.report} onCopy={() => copy(result.report, "report")} copied={copied === "report"} />
          )}

        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function MarkdownCard({ content, onCopy, copied }: { content: string; onCopy: () => void; copied: boolean }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex justify-end p-3 border-b">
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado!" : "Copiar tudo"}
          </button>
        </div>
        <div className="p-5">
          <MarkdownRenderer text={content} />
        </div>
      </CardContent>
    </Card>
  )
}

function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("## "))     return <h2 key={i} className="text-base font-semibold mt-4 mb-1 text-foreground">{line.slice(3)}</h2>
        if (line.startsWith("### "))    return <h3 key={i} className="text-sm font-semibold mt-3 mb-1 text-foreground">{line.slice(4)}</h3>
        if (line.startsWith("| "))      return <p key={i} className="font-mono text-xs bg-muted/50 px-2 py-0.5 rounded">{line}</p>
        if (line.startsWith("- ") || line.startsWith("* "))
          return <div key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">•</span><span>{line.slice(2)}</span></div>
        if (/^\d+\.\s/.test(line))
          return <div key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0 font-mono text-xs">{line.match(/^\d+/)?.[0]}.</span><span>{line.replace(/^\d+\.\s/, "")}</span></div>
        if (line.startsWith("**") && line.endsWith("**"))
          return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>
        if (line.trim() === "---") return <hr key={i} className="border-border my-3" />
        if (!line.trim())           return <div key={i} className="h-1" />
        // inline bold
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        )
      })}
    </div>
  )
}
