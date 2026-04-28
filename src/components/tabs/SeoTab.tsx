import { useState, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useProducts } from "@/contexts/ProductsContext"
import { useAuth } from "@/contexts/AuthContext"
import { useShopReset } from "@/hooks/useShopReset"
import { serverSave, serverLoad, BRL } from "@/services/ml-api"
import { apifyRun, claudeAnalyze } from "@/server/ml-oauth"
import { toast } from "sonner"
import {
  Search, Loader2, Star, TrendingUp, Zap, FileText,
  ListChecks, BarChart2, Copy, Check, RefreshCw,
  ChevronDown, ChevronRight, Eye, Key, Package,
  AlertTriangle, ExternalLink,
} from "lucide-react"

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Competitor {
  position:     number
  title:        string
  price:        number
  stars:        number
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
  keyword:     string
  productId:   string
  productName: string
  competitors: Competitor[]
  analysis:    string
  titles:      GeneratedTitle[]
  description: string
  longtails:   string
  qa:          string
  report:      string
  savedAt:     string
}

type Step = "ranking" | "titles" | "description" | "longtails" | "qa" | "report"

const TABS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "ranking",     label: "Ranking",          icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { id: "titles",      label: "Títulos",           icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "description", label: "Descrição",         icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "longtails",   label: "Keywords",          icon: <Search className="h-3.5 w-3.5" /> },
  { id: "qa",          label: "Q&A",               icon: <ListChecks className="h-3.5 w-3.5" /> },
  { id: "report",      label: "Relatório",         icon: <TrendingUp className="h-3.5 w-3.5" /> },
]

const CACHE_PREFIX = "seo-result:"

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePrice(raw: string | number | undefined): number {
  if (!raw) return 0
  if (typeof raw === "number") return raw
  return parseFloat(String(raw).replace(/[R$\s.]/g, "").replace(",", ".")) || 0
}

function parseTitles(raw: string): GeneratedTitle[] {
  const blocks = raw.split(/---+/).filter(b => b.includes("TÍTULO:"))
  return blocks.map(block => {
    const get = (key: string) => block.match(new RegExp(`${key}:\\s*(.+)`))?.[1]?.trim() || ""
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
}

// ── Componente ────────────────────────────────────────────────────────────────

export function SeoTab() {
  const { products } = useProducts()
  const { currentShop } = useAuth()
  const shopId = currentShop?.id ?? "default"
  const mlProducts = products.filter(p => p.mlItemId)

  // Configurações (localStorage)
  const [apifyToken,  setApifyToken]  = useState(() => localStorage.getItem("apify-token") || "")
  const [claudeKey,   setClaudeKey]   = useState(() => localStorage.getItem("claude-api-key") || "")
  const [showKeys,    setShowKeys]    = useState(false)

  // Formulário
  const [selectedId,  setSelectedId]  = useState("")
  const [keyword,     setKeyword]     = useState("")
  const [pages,       setPages]       = useState(2)

  // Estado
  const [loading,     setLoading]     = useState(false)
  const [step,        setStep]        = useState("")
  const [result,      setResult]      = useState<SeoResult | null>(null)
  const [activeTab,   setActiveTab]   = useState<Step>("ranking")
  const [copied,      setCopied]      = useState<string | null>(null)
  const [showRaw,     setShowRaw]     = useState(false)
  const [savedList,   setSavedList]   = useState<{ key: string; label: string; savedAt: string }[]>([])

  const selectedProduct = mlProducts.find(p => p.mlItemId === selectedId)

  useShopReset(useCallback(() => {
    setSelectedId(""); setKeyword(""); setResult(null)
  }, []))

  // ── Salvar chaves ─────────────────────────────────────────────────────────
  const saveApify = (v: string) => { setApifyToken(v); localStorage.setItem("apify-token", v) }
  const saveClaude = (v: string) => { setClaudeKey(v); localStorage.setItem("claude-api-key", v) }

  // ── Copy ──────────────────────────────────────────────────────────────────
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  // ── Listar análises salvas ────────────────────────────────────────────────
  const loadSavedList = useCallback(async () => {
    try {
      const saved: { key: string; label: string; savedAt: string }[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || ""
        if (!k.includes(`megalabs:${shopId}:${CACHE_PREFIX}`)) continue
        const raw = localStorage.getItem(k)
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          const data: SeoResult = parsed.data
          if (data?.keyword && data?.productName) {
            saved.push({
              key:     k,
              label:   `${data.productName.slice(0, 35)}… — "${data.keyword}"`,
              savedAt: data.savedAt,
            })
          }
        } catch {}
      }
      saved.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      setSavedList(saved)
    } catch {}
  }, [shopId])

  useEffect(() => { loadSavedList() }, [loadSavedList])

  // ── Carregar análise salva ────────────────────────────────────────────────
  const loadSaved = async (cacheKey: string) => {
    try {
      const cacheShortKey = cacheKey.split(`:${CACHE_PREFIX}`)[1]
      const cached = await serverLoad<SeoResult>(CACHE_PREFIX + cacheShortKey)
      if (cached?.data) {
        setResult(cached.data)
        setActiveTab("ranking")
        toast.success("Análise carregada.")
      }
    } catch { toast.error("Erro ao carregar análise salva.") }
  }

  // ── Deletar análise salva ─────────────────────────────────────────────────
  const deleteSaved = (key: string) => {
    localStorage.removeItem(key)
    loadSavedList()
    if (result && key.includes(result.productId)) setResult(null)
    toast.success("Análise removida.")
  }

  // ── Claude via server function ────────────────────────────────────────────
  const askClaude = async (prompt: string, maxTokens = 2000): Promise<string> => {
    const key = claudeKey.trim()
    if (!key) throw new Error("Insira sua API key da Anthropic nas configurações acima.")
    const text = await claudeAnalyze({ data: { apiKey: key, prompt, maxTokens } })
    const parsed = JSON.parse(text)
    return parsed.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || ""
  }

  // ── Fluxo principal ───────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!apifyToken.trim()) { toast.error("Insira o token do Apify."); setShowKeys(true); return }
    if (!claudeKey.trim())  { toast.error("Insira a API key da Anthropic."); setShowKeys(true); return }
    if (!selectedId)        { toast.error("Selecione um anúncio."); return }
    if (!keyword.trim())    { toast.error("Insira a keyword."); return }
    if (!selectedProduct)   return

    setLoading(true); setResult(null)

    try {
      // ── 1. Apify via server function ─────────────────────────────────────
      setStep(`Buscando top ${pages * 60} concorrentes para "${keyword}"...`)
      const rawText = await apifyRun({ data: { token: apifyToken.trim(), keyword: keyword.trim(), pages } })
      const rawItems: any[] = JSON.parse(rawText)

      if (!rawItems?.length) throw new Error("Apify não retornou resultados. Verifique a keyword e o token.")

      const competitors: Competitor[] = rawItems.map((item, idx) => ({
        position:     idx + 1,
        title:        item.zProdutoNome || "",
        price:        parsePrice(item.zProdutoPrecoNovo),
        stars:        parseFloat(item.zProdutoEstrelas || "0") || 0,
        brand:        item.zProdutoMarca || "",
        url:          item.zProdutoLink || "",
        image:        item.zProdutoImagem || "",
        isSponsored:  !!(item.zProdutoLink?.includes("sponsored")),
        freeShipping: !!(item.freteGratis || item.freeShipping || item.zFrete?.toLowerCase().includes("grátis")),
      }))

      const top20 = competitors.slice(0, 20)
      const productInfo = {
        titulo:  selectedProduct.name,
        preco:   selectedProduct.listings.find(l => l.channel === "ml")?.currentPrice || 0,
        mlItemId: selectedProduct.mlItemId,
      }

      const competitorsJson = JSON.stringify(
        top20.map(c => ({ pos: c.position, titulo: c.title, preco: c.price, estrelas: c.stars, frete_gratis: c.freeShipping, patrocinado: c.isSponsored, marca: c.brand })),
        null, 2,
      )

      // ── 2. Análise de ranking ─────────────────────────────────────────────
      setStep("Analisando padrões de ranking (1/5)...")
      const analysis = await askClaude(`
Você é especialista em SEO de marketplace brasileiro. Analise os TOP ${top20.length} produtos ranqueados para a keyword "${keyword}" no Mercado Livre Brasil.

CONCORRENTES (JSON):
${competitorsJson}

PRODUTO DO VENDEDOR:
${JSON.stringify(productInfo)}

Análise em 6 seções:

## 1. PADRÕES DE TÍTULO
- Estrutura dominante dos top rankers
- Top 8 palavras-chave presentes em 50%+ dos top 10
- Comprimento médio (mín, médio, máx em caracteres)
- Diferença títulos posição 1-5 vs 6-20

## 2. PREÇO E CONVERSÃO
- Preço mínimo, médio e máximo do top 10
- % com frete grátis
- Análise de competitividade de preço

## 3. SOCIAL PROOF
- Nota média de estrelas top 5 vs demais
- Mínimo de estrelas para aparecer no top 10

## 4. OPORTUNIDADES
- 3 pontos fracos dos top rankers exploráveis
- Dificuldade: FÁCIL | MÉDIO | DIFÍCIL | MUITO DIFÍCIL
- Top 3 quick wins (ações imediatas de alto impacto)

## 5. DIAGNÓSTICO DO ANÚNCIO ATUAL
- Gap vs top 3
- Score atual: X/100
- Score potencial após otimizações: X/100

## 6. KEYWORDS DOS TOP RANKERS
10 principais keywords/longtails encontradas nos títulos (uma por linha)

Responda em português com dados concretos (%, médias). Seja direto.
`, 2000)

      // ── 3. Títulos ────────────────────────────────────────────────────────
      setStep("Gerando títulos otimizados (2/5)...")
      const titlesRaw = await askClaude(`
Gere 5 títulos otimizados para Mercado Livre para o produto abaixo.

PRODUTO ATUAL: ${selectedProduct.name}
KEYWORD: ${keyword}

PADRÕES DOS TOP RANKERS:
${analysis.slice(0, 1000)}

REGRAS:
- Máximo 60 caracteres (ideal 50-55)
- Keyword principal nos primeiros 30 chars
- Proibido: PROMOÇÃO, OFERTA, GRÁTIS, !!, ***, >>>
- Usar atributos que dominam no top 10

Use EXATAMENTE este formato para cada título (separe por ---):
---
T�TULO: [texto do título]
CHARS: [número]
KEYWORDS: [kw1, kw2, kw3]
ESTRATÉGIA: [descrição em 1 linha]
SCORE: [0-100]
POR QUÊ: [1 linha justificando]
---
`, 1200)
      const titles = parseTitles(titlesRaw)

      // ── 4. Descrição ──────────────────────────────────────────────────────
      setStep("Gerando descrição otimizada (3/5)...")
      const description = await askClaude(`
Crie descrição otimizada para Mercado Livre.

PRODUTO: ${selectedProduct.name}
KEYWORD: ${keyword}
KEYWORDS SECUNDÁRIAS (extraídas dos top rankers):
${analysis.match(/## 6[\s\S]*?(?=##|$)/)?.[0]?.slice(0, 400) || ""}

Estrutura obrigatória:
**Abertura (2-3 linhas):** keyword principal + benefício principal

**Especificações:**
✓ [Feature] — [Benefício]
(6-8 itens)

**Para quem é:** 2-3 casos de uso reais

**Garantia e suporte:** política de devolução + atendimento

Entre 800 e 1.500 caracteres.

Responda com DUAS versões claramente separadas:

=== VERSÃO MARKDOWN ===
[com formatação]

=== VERSÃO TEXTO PLANO ===
[sem markdown, para copiar direto no ML]
`, 2000)

      // ── 5. Longtails ──────────────────────────────────────────────────────
      setStep("Extraindo keywords e longtails (4/5)...")
      const longtails = await askClaude(`
Analise os títulos dos TOP ${top20.length} concorrentes para "${keyword}" e extraia estratégia completa de keywords.

T�TULOS:
${top20.map((c, i) => `${i+1}. ${c.title}`).join("\n")}

## LONGTAILS PRIMÁRIOS
20 termos de 2-4 palavras | volume: alto/médio/baixo | intenção: compra/pesquisa/comparação

## VARIAÇÕES SEMÂNTICAS
10 formas diferentes de buscar o mesmo produto

## ATRIBUTOS TÉCNICOS MAIS BUSCADOS
Características específicas dos top rankers (tamanho, material, cor, modelo, etc.)

## AUTOCOMPLETE
Como compradores começam a digitar (padrões: "produto para...", "produto com...", etc.)

## TERMOS NEGATIVOS
Palavras que NÃO devem estar no título/descrição

## COMO DISTRIBUIR
- Título (60 chars): quais keywords priorizar
- Primeiros 100 chars da descrição: quais incluir
- Atributos técnicos: o que preencher
`, 2000)

      // ── 6. Q&A ────────────────────────────────────────────────────────────
      setStep("Gerando Q&A (5/5)...")
      const qa = await askClaude(`
Crie 8 pares de pergunta e resposta para o produto abaixo, otimizados para SEO no Mercado Livre.

PRODUTO: ${selectedProduct.name}
KEYWORD: ${keyword}

Regras:
- Perguntas: dúvidas reais (técnicas, compatibilidade, uso, entrega, garantia)
- Respostas: máx 120 palavras, incluir keywords naturalmente, tom prestativo
- Variações: técnica, de uso, de entrega, de garantia, de comparação

Formato:
P1: [pergunta como comprador real escreveria]
R1: [resposta otimizada]

[repetir até P8/R8]
`, 1500)

      // ── 7. Relatório ──────────────────────────────────────────────────────
      setStep("Finalizando relatório...")
      const report = await askClaude(`
Relatório executivo de 1 página para "${keyword}" no Mercado Livre.

ANÁLISE:
${analysis.slice(0, 1200)}

PRODUTO: ${selectedProduct.name}

## RESUMO EXECUTIVO
3-5 linhas diretas: situação, problema principal, oportunidade.

## TOP 3 DESCOBERTAS
O que mais importa nos dados coletados.

## PLANO DE AÇÃO
| Ação | Impacto | Esforço | Prazo |
|------|---------|---------|-------|
[5-7 ações concretas e priorizadas]

## MÉTRICAS (próximos 30 dias)
KPIs principais para medir sucesso.

## PRÓXIMOS 5 PASSOS
Ordenados por prioridade, com prazo concreto.

Formato Markdown. Direto, sem enrolação.
`, 1500)

      // ── Salva resultado ───────────────────────────────────────────────────
      const saved: SeoResult = {
        keyword:     keyword.trim(),
        productId:   selectedId,
        productName: selectedProduct.name,
        competitors,
        analysis, titles, description, longtails, qa, report,
        savedAt:     new Date().toISOString(),
      }
      setResult(saved)
      setActiveTab("ranking")

      const cacheKey = `${CACHE_PREFIX}${selectedId}-${keyword.trim().replace(/\s+/g, "-").toLowerCase()}`
      await serverSave(cacheKey, saved)
      await loadSavedList()

      toast.success(`✓ ${competitors.length} concorrentes analisados e resultado salvo`)

    } catch (e) {
      toast.error("Erro: " + (e as Error).message)
    } finally {
      setLoading(false); setStep("")
    }
  }, [apifyToken, claudeKey, selectedId, keyword, pages, selectedProduct, loadSavedList])

  // ── Render ────────────────────────────────────────────────────────────────

  const hasCreds = apifyToken.trim() && claudeKey.trim()
  const currentPrice = selectedProduct?.listings.find(l => l.channel === "ml")?.currentPrice || 0

  return (
    <div className="space-y-4">

      {/* ── Configurações ─────────────────────────────────────────────────── */}
      <Card className={!hasCreds ? "border-yellow-300" : ""}>
        <CardHeader className="pb-2">
          <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowKeys(v => !v)}>
            <Key className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Configurações de API</CardTitle>
            {!hasCreds && <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs ml-1">Necessário</Badge>}
            {hasCreds  && <Badge className="bg-green-500/15 text-green-700 border-0 text-xs ml-1">✓ Configurado</Badge>}
            {showKeys ? <ChevronDown className="h-4 w-4 ml-auto" /> : <ChevronRight className="h-4 w-4 ml-auto" />}
          </button>
        </CardHeader>
        {showKeys && (
          <CardContent className="space-y-3 pt-0">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Token Apify
                <a href="https://console.apify.com/account/integrations" target="_blank" rel="noreferrer"
                  className="ml-2 text-blue-600 hover:underline">obter ↗</a>
              </label>
              <Input type="password" placeholder="apify_api_xxxxxxxxxxxx"
                value={apifyToken} onChange={e => saveApify(e.target.value)} className="font-mono text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                API Key Anthropic (Claude)
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
                  className="ml-2 text-blue-600 hover:underline">obter ↗</a>
              </label>
              <Input type="password" placeholder="sk-ant-xxxxxxxxxxxx"
                value={claudeKey} onChange={e => saveClaude(e.target.value)} className="font-mono text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">
              Chaves salvas localmente no navegador. Nunca enviadas a terceiros — apenas usadas para as chamadas de API.
            </p>
          </CardContent>
        )}
      </Card>

      {/* ── Formulário ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Análise SEO Competitiva
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground mb-1 block">Anúncio</label>
              <select className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                <option value="">— selecione —</option>
                {mlProducts.map(p => (
                  <option key={p.mlItemId} value={p.mlItemId!}>
                    {p.name.length > 45 ? p.name.slice(0, 45) + "…" : p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Keyword principal</label>
              <Input placeholder="ex: tênis masculino branco"
                value={keyword} onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && run()} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Páginas Apify (~{pages * 60} resultados · ~${(pages * 0.06).toFixed(2)})
              </label>
              <select className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={pages} onChange={e => setPages(+e.target.value)}>
                <option value={1}>1 página (~60)</option>
                <option value={2}>2 páginas (~120)</option>
                <option value={3}>3 páginas (~180)</option>
              </select>
            </div>
          </div>

          {selectedProduct && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#E8EDFF]/40 border border-[#2D3277]/20">
              <img src={selectedProduct.image} alt="" className="h-9 w-9 rounded object-cover bg-muted shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{selectedProduct.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedProduct.mlItemId}</div>
              </div>
              <div className="text-sm font-bold text-[#2D3277] shrink-0">{BRL(currentPrice)}</div>
            </div>
          )}

          <Button className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456] font-semibold"
            onClick={run} disabled={loading || !selectedId || !keyword.trim()}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{step}</>
              : <><Search className="h-4 w-4 mr-2" />Analisar concorrentes</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Análises salvas ───────────────────────────────────────────────── */}
      {savedList.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Análises salvas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {savedList.map(s => (
              <div key={s.key} className="flex items-center gap-3 px-4 py-3 border-t hover:bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{s.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.savedAt).toLocaleString("pt-BR")}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => loadSaved(s.key)}>Carregar</Button>
                <button onClick={() => deleteSaved(s.key)}
                  className="text-xs text-red-400 hover:text-red-600">Remover</button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Estado vazio ──────────────────────────────────────────────────── */}
      {!result && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Selecione um anúncio e insira a keyword</p>
            <p className="text-sm mt-1">O Apify busca os top concorrentes e o Claude analisa os padrões de ranking.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Resultado ─────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">"{result.keyword}"</span>
            <Badge className="bg-[#2D3277]/10 text-[#2D3277] border-0">{result.competitors.length} concorrentes</Badge>
            <Badge className="bg-green-500/15 text-green-700 border-0">
              {result.competitors.filter(c => !c.isSponsored).length} orgânicos
            </Badge>
            <Badge className="bg-yellow-400/20 text-yellow-700 border-0">
              {result.competitors.filter(c => c.isSponsored).length} patrocinados
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              Salvo em {new Date(result.savedAt).toLocaleString("pt-BR")}
            </span>
            <Button size="sm" variant="outline" onClick={run} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refazer
            </Button>
          </div>

          {/* ── Lista de resultados Apify ─────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <button className="flex items-center gap-2 w-full text-left"
                onClick={() => setShowRaw(v => !v)}>
                {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <CardTitle className="text-sm">
                  Resultados do Apify — {result.competitors.length} anúncios coletados
                </CardTitle>
                <span className="text-xs text-muted-foreground ml-auto">clique para {showRaw ? "ocultar" : "ver"}</span>
              </button>
            </CardHeader>
            {showRaw && (
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                    <tr>
                      {["#","Imagem","Título","Preço","⭐","Frete","Tipo","Link"].map(h => (
                        <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.competitors.map(c => (
                      <tr key={c.position} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground w-8">{c.position}</td>
                        <td className="px-3 py-2">
                          {c.image
                            ? <img src={c.image} alt="" className="h-10 w-10 rounded object-cover bg-muted"
                                onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                            : <Package className="h-8 w-8 text-muted-foreground/30" />}
                        </td>
                        <td className="px-3 py-2 max-w-[220px]">
                          <div className="truncate font-medium text-xs" title={c.title}>{c.title}</div>
                          {c.brand && <div className="text-xs text-muted-foreground">{c.brand}</div>}
                        </td>
                        <td className="px-3 py-2 font-semibold whitespace-nowrap text-xs">{BRL(c.price)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {c.stars > 0
                            ? <span className="flex items-center gap-0.5">
                                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                {c.stars.toFixed(1)}
                              </span>
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {c.freeShipping
                            ? <Badge className="bg-green-500/15 text-green-700 border-0 text-xs">Grátis</Badge>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {c.isSponsored
                            ? <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs">Patrocinado</Badge>
                            : <Badge className="bg-blue-500/15 text-blue-700 border-0 text-xs">Orgânico</Badge>}
                        </td>
                        <td className="px-3 py-2">
                          {c.url && (
                            <a href={c.url} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:text-blue-800">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>

          {/* Tabs de análise */}
          <div className="flex gap-1 flex-wrap border-b">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? "border-[#2D3277] text-[#2D3277]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {activeTab === "ranking" && (
            <MDCard content={result.analysis} copyKey="analysis" copied={copied} onCopy={copy} />
          )}
          {activeTab === "titles" && (
            <div className="space-y-3">
              {result.titles.length === 0 && (
                <Card><CardContent className="py-8 text-center text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
                  Títulos não gerados corretamente. Tente refazer a análise.
                </CardContent></Card>
              )}
              {result.titles.map((t, i) => (
                <Card key={i} className={i === 0 ? "border-[#2D3277]/30" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {i === 0 && <Badge className="bg-[#2D3277] text-[#FFE600] border-0 text-xs">Recomendado</Badge>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          t.score >= 80 ? "bg-green-500/15 text-green-700"
                          : t.score >= 60 ? "bg-yellow-400/20 text-yellow-700"
                          : "bg-red-500/15 text-red-700"
                        }`}>Score {t.score}/100</span>
                        <span className="text-xs text-muted-foreground">{t.chars} chars</span>
                      </div>
                      <CopyBtn text={t.text} id={`t${i}`} copied={copied} onCopy={copy} />
                    </div>
                    <p className="font-semibold mb-2">{t.text}</p>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {t.keywords.map(k => (
                        <span key={k} className="text-xs px-2 py-0.5 bg-muted rounded-full">{k}</span>
                      ))}
                    </div>
                    {t.strategy && <p className="text-xs text-muted-foreground"><strong className="text-foreground">Estratégia:</strong> {t.strategy}</p>}
                    {t.why && <p className="text-xs text-muted-foreground mt-0.5"><strong className="text-foreground">Por quê:</strong> {t.why}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {activeTab === "description" && (
            <MDCard content={result.description} copyKey="desc" copied={copied} onCopy={copy} />
          )}
          {activeTab === "longtails" && (
            <MDCard content={result.longtails} copyKey="longtails" copied={copied} onCopy={copy} />
          )}
          {activeTab === "qa" && (
            <MDCard content={result.qa} copyKey="qa" copied={copied} onCopy={copy} />
          )}
          {activeTab === "report" && (
            <MDCard content={result.report} copyKey="report" copied={copied} onCopy={copy} />
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function CopyBtn({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <button onClick={() => onCopy(text, id)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {copied === id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "Copiado!" : "Copiar"}
    </button>
  )
}

function MDCard({ content, copyKey, copied, onCopy }: { content: string; copyKey: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex justify-end p-3 border-b">
          <CopyBtn text={content} id={copyKey} copied={copied} onCopy={onCopy} />
        </div>
        <div className="p-5 space-y-1.5 text-sm leading-relaxed">
          {content.split("\n").map((line, i) => {
            if (line.startsWith("## "))    return <h2 key={i} className="text-base font-semibold mt-4 mb-1">{line.slice(3)}</h2>
            if (line.startsWith("### "))   return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(4)}</h3>
            if (line.startsWith("=== "))   return <h2 key={i} className="text-sm font-semibold mt-4 mb-1 text-[#2D3277] border-b pb-1">{line.slice(4).replace(" ===","")}</h2>
            if (line.startsWith("| "))     return <p key={i} className="font-mono text-xs bg-muted/50 px-2 py-0.5 rounded whitespace-pre">{line}</p>
            if (line.startsWith("- ") || line.startsWith("* "))
              return <div key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">•</span><span>{line.slice(2)}</span></div>
            if (/^\d+\.\s/.test(line))
              return <div key={i} className="flex gap-2"><span className="text-muted-foreground font-mono text-xs shrink-0">{line.match(/^\d+/)?.[0]}.</span><span>{line.replace(/^\d+\.\s/, "")}</span></div>
            if (line.startsWith("✓ "))
              return <div key={i} className="flex gap-2 text-green-700"><span className="shrink-0">✓</span><span>{line.slice(2)}</span></div>
            if (/^P\d+:/.test(line))
              return <p key={i} className="font-semibold mt-3">{line}</p>
            if (/^R\d+:/.test(line))
              return <p key={i} className="text-muted-foreground ml-4 mb-2">{line}</p>
            if (line.trim() === "---")    return <hr key={i} className="border-border my-3" />
            if (!line.trim())             return <div key={i} className="h-1" />
            const parts = line.split(/(\*\*[^*]+\*\*)/)
            return (
              <p key={i}>
                {parts.map((p, j) =>
                  p.startsWith("**") && p.endsWith("**")
                    ? <strong key={j}>{p.slice(2, -2)}</strong>
                    : p
                )}
              </p>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
