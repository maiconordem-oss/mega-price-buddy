import { useState, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useProducts } from "@/contexts/ProductsContext"
import { useAuth } from "@/contexts/AuthContext"
import { useShopReset } from "@/hooks/useShopReset"
import { serverSave, serverLoad, BRL } from "@/services/ml-api"
import { firecrawlScrape, claudeAnalyze } from "@/server/ml-oauth"
import { toast } from "sonner"
import {
  Search, Loader2, Star, TrendingUp, Zap, FileText,
  ListChecks, BarChart2, Copy, Check, RefreshCw,
  ChevronDown, ChevronRight, Key, Package,
  AlertTriangle, ExternalLink, Trophy, Target,
  Lightbulb, DollarSign, MessageSquare,
} from "lucide-react"

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface RawItem {
  zProdutoNome?: string
  zProdutoLink?: string
  zProdutoImagem?: string
  zProdutoPrecoNovo?: string | number
  zProdutoPrecoPrevio?: string | number
  zProdutoEstrelas?: string | number
  zProdutoCondicao?: string
  zProdutoMarca?: string
  zProdutoDescricao?: string
  ranking_position: number
  is_sponsored: boolean
  [key: string]: unknown
}

interface Competitor {
  posicao:       number
  titulo:        string
  url:           string
  imagem:        string
  preco:         number
  preco_anterior: number | null
  avaliacao:     number | null
  condicao:      string
  marca:         string
  descricao:     string
  patrocinado:   boolean
  frete_gratis:  boolean
}

// Estrutura JSON que Claude retorna na análise de ranking
interface AnaliseJSON {
  padroes_titulo: {
    estrutura_dominante: string
    keywords_frequentes: string[]
    comprimento_medio: number
    comprimento_min: number
    comprimento_max: number
    palavras_evitar: string[]
    titulos_top5: string[]
  }
  fatores_conversao: {
    frete_gratis_pct: number
    preco_medio_top5: number
    preco_min_top5: number
    preco_max_top5: number
    preco_mediano: number
    fulfillment_pct: number
    desconto_exibido_pct: number
  }
  social_proof: {
    avaliacoes_media_top5: number
    avaliacoes_minimo_top10: number
    vendas_media_top5: number | null
    correlacao_avaliacao_posicao: string
  }
  dificuldade: "FÁCIL" | "MÉDIO" | "DIFÍCIL" | "MUITO DIFÍCIL"
  justificativa_dificuldade: string
  oportunidades: string[]
  quick_wins: string[]
  score_oportunidade: number
  diagnostico_produto?: {
    gap_vs_top3: string[]
    score_atual: number
    score_potencial: number
    principais_problemas: string[]
  }
}

// Estrutura JSON que Claude retorna no conteúdo
interface ConteudoJSON {
  titulos: Array<{
    texto:      string
    caracteres: number
    keywords:   string[]
    estrategia: string
    score:      number
    por_que:    string
  }>
  descricao_markdown: string
  descricao_texto:    string
  longtails: Array<{
    termo:    string
    volume:   "alto" | "médio" | "baixo"
    intencao: string
  }>
  variações_semanticas: string[]
  atributos_tecnicos:   string[]
  termos_negativos:     string[]
  autocomplete:         string[]
  qa: Array<{ pergunta: string; resposta: string }>
  plano_acao: Array<{
    acao:         string
    impacto:      "Alto" | "Médio" | "Baixo"
    esforco:      "Alto" | "Médio" | "Baixo"
    prazo:        string
    responsavel:  string
  }>
  resumo_executivo: string
  top3_descobertas: string[]
  metricas_30d:     string[]
  proximos_passos:  string[]
}

interface SeoResult {
  keyword:     string
  productId:   string
  productName: string
  competitors: Competitor[]
  analise:     AnaliseJSON
  conteudo:    ConteudoJSON
  savedAt:     string
}

type ActiveTab = "ranking" | "titles" | "description" | "keywords" | "qa" | "report"

const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
  { id: "ranking",     label: "Ranking",    icon: <BarChart2 className="h-3.5 w-3.5" /> },
  { id: "titles",      label: "Títulos",    icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "description", label: "Descrição",  icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "keywords",    label: "Keywords",   icon: <Search className="h-3.5 w-3.5" /> },
  { id: "qa",          label: "Q&A",        icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { id: "report",      label: "Relatório",  icon: <TrendingUp className="h-3.5 w-3.5" /> },
]

const CACHE_PREFIX = "seo-v3:"

// ── Helpers ───────────────────────────────────────────────────────────────────

function extrairPreco(texto: string | number | undefined): number | null {
  if (!texto) return null
  if (typeof texto === "number") return texto
  const clean = String(texto).replace(/\./g, "").replace(",", ".").match(/[\d.]+/)
  return clean ? parseFloat(clean[0]) : null
}

function detectarFrete(item: RawItem): boolean {
  const keys = Object.keys(item)
  const freteKey = keys.find(k => k.toLowerCase().includes("frete"))
  if (!freteKey) return false
  const val = String(item[freteKey] || "").toLowerCase()
  return val.includes("grát") || val.includes("grat") || val === "true"
}

function normalizarItem(item: RawItem): Competitor {
  return {
    posicao:        item.ranking_position,
    titulo:         item.zProdutoNome || "",
    url:            item.zProdutoLink || "",
    imagem:         item.zProdutoImagem || "",
    preco:          extrairPreco(item.zProdutoPrecoNovo) || 0,
    preco_anterior: extrairPreco(item.zProdutoPrecoPrevio),
    avaliacao:      parseFloat(String(item.zProdutoEstrelas || "")) || null,
    condicao:       item.zProdutoCondicao || "novo",
    marca:          item.zProdutoMarca || "",
    descricao:      item.zProdutoDescricao || "",
    patrocinado:    item.is_sponsored,
    frete_gratis:   detectarFrete(item),
  }
}

function parseJSON<T>(text: string): T | null {
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try { return JSON.parse(clean) as T }
  catch { return null }
}

// ── Componente ────────────────────────────────────────────────────────────────

export function SeoTab() {
  const { products } = useProducts()
  const { currentShop } = useAuth()
  const shopId = currentShop?.id ?? "default"
  const mlProducts = products.filter(p => p.mlItemId)

  const [claudeKey,  setClaudeKey]  = useState(() => localStorage.getItem("claude-api-key") || "")
  const [showKeys,   setShowKeys]   = useState(false)

  const [selectedId, setSelectedId] = useState("")
  const [keyword,    setKeyword]    = useState("")
  const [pages]                     = useState(3) // fixo: 3 páginas Firecrawl ≈ 144, cortado em 100

  const [loading,    setLoading]    = useState(false)
  const [step,       setStep]       = useState("")
  const [result,     setResult]     = useState<SeoResult | null>(null)
  const [activeTab,  setActiveTab]  = useState<ActiveTab>("ranking")
  const [copied,     setCopied]     = useState<string | null>(null)
  const [showRaw,    setShowRaw]    = useState(false)
  const [savedList,  setSavedList]  = useState<{ key: string; label: string; savedAt: string }[]>([])
  const [rawDebug,   setRawDebug]   = useState<string | null>(null)

  const selectedProduct = mlProducts.find(p => p.mlItemId === selectedId)

  useShopReset(useCallback(() => {
    setSelectedId(""); setKeyword(""); setResult(null); setRawDebug(null)
  }, []))

  const saveClaude = (v: string) => { setClaudeKey(v);  localStorage.setItem("claude-api-key", v) }

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  // ── Análises salvas ───────────────────────────────────────────────────────
  const loadSavedList = useCallback(async () => {
    const saved: { key: string; label: string; savedAt: string }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ""
      if (!k.includes(`megalabs:${shopId}:${CACHE_PREFIX}`)) continue
      try {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        const d: SeoResult = parsed.data
        if (d?.keyword && d?.productName)
          saved.push({ key: k, label: `${d.productName.slice(0,30)}… — "${d.keyword}"`, savedAt: d.savedAt })
      } catch {}
    }
    setSavedList(saved.sort((a,b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()))
  }, [shopId])

  useEffect(() => { loadSavedList() }, [loadSavedList])

  const loadSaved = async (fullKey: string) => {
    const shortKey = fullKey.split(`:${CACHE_PREFIX}`)[1]
    const cached = await serverLoad<SeoResult>(CACHE_PREFIX + shortKey)
    if (cached?.data) { setResult(cached.data); setActiveTab("ranking"); toast.success("Análise carregada.") }
  }

  const deleteSaved = (k: string) => {
    localStorage.removeItem(k); loadSavedList()
    toast.success("Análise removida.")
  }

  // ── Claude via server function ────────────────────────────────────────────
  const askClaude = async (prompt: string, maxTokens = 1500): Promise<string> => {
    if (!claudeKey.trim()) throw new Error("Insira a API key da Anthropic nas configurações.")
    const text = await claudeAnalyze({ data: { apiKey: claudeKey.trim(), prompt, maxTokens } })
    const parsed = JSON.parse(text)
    return parsed.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || ""
  }

  // ── Fluxo principal ───────────────────────────────────────────────────────
  const run = useCallback(async () => {
    
    if (!claudeKey.trim())  { toast.error("Insira a API key da Anthropic."); setShowKeys(true); return }
    if (!selectedId)        { toast.error("Selecione um anúncio."); return }
    if (!keyword.trim())    { toast.error("Insira a keyword."); return }
    if (!selectedProduct)   return

    setLoading(true); setResult(null); setRawDebug(null)

    try {
      // ── STEP 1: Apify ─────────────────────────────────────────────────────
      setStep(`Buscando concorrentes no Mercado Livre...`)
      const rawText = await firecrawlScrape({ data: { keyword: keyword.trim(), pages } })

      let rawItems: RawItem[]
      try { rawItems = JSON.parse(rawText) } catch {
        throw new Error(`Apify retornou resposta inválida. Verifique o token.\n\n${rawText.slice(0,200)}`)
      }

      if (!Array.isArray(rawItems) || rawItems.length === 0)
        throw new Error("Firecrawl não retornou produtos. Verifique a keyword e tente novamente.")

      // Coleta os primeiros 100 anúncios para análise
      rawItems = rawItems.slice(0, 100)

      // Salva debug do primeiro item para diagnóstico
      setRawDebug(JSON.stringify(rawItems[0], null, 2))

      // ── STEP 2: Normalizar (igual ao script da skill) ─────────────────────
      const rawWithMeta: RawItem[] = rawItems.map((item, idx) => ({
        ...item,
        ranking_position: idx + 1,
        is_sponsored: !!(item.zProdutoLink?.toString().includes("sponsored") || item.zProdutoLink?.toString().includes("highlight")),
      }))

      const competitors: Competitor[] = rawWithMeta.map(normalizarItem)
      const top20 = competitors.slice(0, 20)

      // ── STEP 3: Análise de ranking (JSON estruturado) ─────────────────────
      setStep(`Analisando padrões de ranking (${top20.length} concorrentes)...`)

      const dadosReduzidos = top20.map(d => ({
        posicao:      d.posicao,
        titulo:       d.titulo,
        preco:        d.preco,
        preco_de:     d.preco_anterior,
        avaliacao:    d.avaliacao,
        frete_gratis: d.frete_gratis,
        marca:        d.marca,
        patrocinado:  d.patrocinado,
      }))

      const produtoAtual = {
        titulo:   selectedProduct.name,
        preco:    selectedProduct.listings.find(l => l.channel === "ml")?.currentPrice || 0,
        mlItemId: selectedProduct.mlItemId,
      }

      const promptAnalise = `Você é especialista em SEO de marketplace brasileiro com 10 anos de experiência no Mercado Livre.

Analise os TOP ${top20.length} produtos ranqueados para a keyword "${keyword}" no Mercado Livre Brasil.

DADOS DOS CONCORRENTES (JSON):
${JSON.stringify(dadosReduzidos, null, 2)}

PRODUTO DO VENDEDOR:
${JSON.stringify(produtoAtual)}

Responda APENAS com JSON válido, sem markdown, sem texto extra. Estrutura exata:
{
  "padroes_titulo": {
    "estrutura_dominante": "descreva a estrutura ex: Marca + Produto + Atributo + Especificação",
    "keywords_frequentes": ["array com top 10 palavras que aparecem em 50%+ dos top 10"],
    "comprimento_medio": 0,
    "comprimento_min": 0,
    "comprimento_max": 0,
    "palavras_evitar": ["palavras que nunca aparecem nos top rankers ou penalizam"],
    "titulos_top5": ["titulo1", "titulo2", "titulo3", "titulo4", "titulo5"]
  },
  "fatores_conversao": {
    "frete_gratis_pct": 0,
    "preco_medio_top5": 0,
    "preco_min_top5": 0,
    "preco_max_top5": 0,
    "preco_mediano": 0,
    "fulfillment_pct": 0,
    "desconto_exibido_pct": 0
  },
  "social_proof": {
    "avaliacoes_media_top5": 0,
    "avaliacoes_minimo_top10": 0,
    "vendas_media_top5": null,
    "correlacao_avaliacao_posicao": "descreva correlação observada"
  },
  "dificuldade": "FÁCIL|MÉDIO|DIFÍCIL|MUITO DIFÍCIL",
  "justificativa_dificuldade": "explique em 2 linhas",
  "oportunidades": ["3 pontos fracos dos top rankers exploráveis"],
  "quick_wins": ["3 ações de alto impacto imediato com instrução concreta"],
  "score_oportunidade": 0,
  "diagnostico_produto": {
    "gap_vs_top3": ["lista de diferenças específicas do produto atual vs top 3"],
    "score_atual": 0,
    "score_potencial": 0,
    "principais_problemas": ["problemas ordenados por impacto"]
  }
}`

      const analiseRaw = await askClaude(promptAnalise, 1500)
      const analise = parseJSON<AnaliseJSON>(analiseRaw)
      if (!analise) throw new Error(`Claude retornou JSON inválido na análise.\n\nRaw: ${analiseRaw.slice(0, 300)}`)

      // ── STEP 4: Conteúdo otimizado (JSON estruturado) ─────────────────────
      setStep("Gerando títulos, descrição, keywords e Q&A...")

      const promptConteudo = `Com base nos padrões identificados para "${keyword}" no Mercado Livre Brasil:

ANÁLISE DOS CONCORRENTES:
${JSON.stringify(analise, null, 2)}

PRODUTO ATUAL:
${JSON.stringify(produtoAtual)}

T�TULOS TOP 5 DOS CONCORRENTES:
${analise.padroes_titulo.titulos_top5.map((t,i) => `${i+1}. ${t}`).join("\n")}

Gere conteúdo completo otimizado. Responda APENAS com JSON válido:
{
  "titulos": [
    {
      "texto": "título em até 60 chars",
      "caracteres": 0,
      "keywords": ["kw1", "kw2"],
      "estrategia": "descrição da estratégia em 1 linha",
      "score": 0,
      "por_que": "justificativa em 1 linha"
    }
  ],
  "descricao_markdown": "descrição completa 800-1500 chars com **negrito**, listas ✓, etc",
  "descricao_texto": "mesma descrição sem markdown para copiar no ML",
  "longtails": [
    { "termo": "string", "volume": "alto|médio|baixo", "intencao": "compra|pesquisa|comparação" }
  ],
  "variacoes_semanticas": ["10 formas diferentes de buscar o mesmo produto"],
  "atributos_tecnicos": ["características específicas que aparecem nos top rankers"],
  "termos_negativos": ["palavras que não devem aparecer no título/descrição"],
  "autocomplete": ["como compradores começam a digitar na busca"],
  "qa": [
    { "pergunta": "pergunta como comprador real escreveria", "resposta": "resposta otimizada máx 120 palavras" }
  ],
  "plano_acao": [
    { "acao": "descrição", "impacto": "Alto|Médio|Baixo", "esforco": "Alto|Médio|Baixo", "prazo": "Imediato|7 dias|30 dias", "responsavel": "Você|Designer|ML" }
  ],
  "resumo_executivo": "3-5 linhas sobre situação atual, problema principal e oportunidade",
  "top3_descobertas": ["descoberta 1", "descoberta 2", "descoberta 3"],
  "metricas_30d": ["métrica 1 para acompanhar", "métrica 2", "métrica 3"],
  "proximos_passos": ["passo 1 com prazo", "passo 2", "passo 3", "passo 4", "passo 5"]
}

Gere: 5 títulos, 20 longtails, 8 Q&As, 7 ações no plano.
APENAS JSON, sem texto extra.`

      const conteudoRaw = await askClaude(promptConteudo, 2000)
      const conteudo = parseJSON<ConteudoJSON>(conteudoRaw)
      if (!conteudo) throw new Error(`Claude retornou JSON inválido no conteúdo.\n\nRaw: ${conteudoRaw.slice(0, 300)}`)

      // ── STEP 5: Salvar ────────────────────────────────────────────────────
      setStep("Salvando resultado...")
      const saved: SeoResult = {
        keyword:     keyword.trim(),
        productId:   selectedId,
        productName: selectedProduct.name,
        competitors,
        analise,
        conteudo,
        savedAt: new Date().toISOString(),
      }
      setResult(saved)
      setActiveTab("ranking")

      const cacheKey = `${CACHE_PREFIX}${selectedId}-${keyword.trim().replace(/\s+/g, "-").toLowerCase().slice(0, 30)}`
      await serverSave(cacheKey, saved)
      await loadSavedList()

      toast.success(`✓ ${competitors.length} concorrentes analisados e resultado salvo`)

    } catch (e) {
      const msg = (e as Error).message
      toast.error(msg.slice(0, 120))
      console.error("[SEO]", msg)
    } finally {
      setLoading(false); setStep("")
    }
  }, [claudeKey, selectedId, keyword, pages, selectedProduct, loadSavedList])

  // ── Helpers de render ─────────────────────────────────────────────────────

  const hasCreds = claudeKey.trim()
  const currentPrice = selectedProduct?.listings.find(l => l.channel === "ml")?.currentPrice || 0

  const DIFF_COLOR: Record<string, string> = {
    "FÁCIL":       "bg-green-500/15 text-green-700",
    "MÉDIO":       "bg-yellow-400/20 text-yellow-700",
    "DIFÍCIL":     "bg-orange-500/15 text-orange-700",
    "MUITO DIFÍCIL": "bg-red-500/15 text-red-700",
  }

  const VOL_COLOR: Record<string, string> = {
    alto:  "bg-green-500/15 text-green-700",
    médio: "bg-yellow-400/20 text-yellow-700",
    baixo: "bg-muted text-muted-foreground",
  }

  const IMP_COLOR: Record<string, string> = {
    Alto:  "text-green-700",
    Médio: "text-yellow-700",
    Baixo: "text-muted-foreground",
  }

  return (
    <div className="space-y-4">

      {/* ── Chaves de API ─────────────────────────────────────────────────── */}
      <Card className={!hasCreds ? "border-yellow-300" : ""}>
        <CardHeader className="pb-2">
          <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowKeys(v => !v)}>
            <Key className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Configurações de API</CardTitle>
            {!hasCreds ? <Badge className="bg-yellow-400/20 text-yellow-700 border-0 text-xs ml-1">Necessário</Badge>
                       : <Badge className="bg-green-500/15 text-green-700 border-0 text-xs ml-1">✓ Configurado</Badge>}
            {showKeys ? <ChevronDown className="h-4 w-4 ml-auto" /> : <ChevronRight className="h-4 w-4 ml-auto" />}
          </button>
        </CardHeader>
        {showKeys && (
          <CardContent className="space-y-3 pt-0">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                API Key Anthropic (Claude)
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="ml-2 text-blue-600 hover:underline">obter ↗</a>
              </label>
              <Input type="password" placeholder="sk-ant-xxxxxxxxxxxx" value={claudeKey} onChange={e => saveClaude(e.target.value)} className="font-mono text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">Chave salva no navegador. A integração Firecrawl é gerenciada pelo servidor automaticamente.</p>
          </CardContent>
        )}
      </Card>

      {/* ── Formulário ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Análise SEO Competitiva — Mercado Livre
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Anúncio</label>
              <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                <option value="">— selecione —</option>
                {mlProducts.map(p => (
                  <option key={p.mlItemId} value={p.mlItemId!}>{p.name.length > 45 ? p.name.slice(0,45)+"…" : p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Keyword principal</label>
              <Input placeholder="ex: tênis masculino branco" value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Resultados</label>
              <div className="h-9 flex items-center px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                100 anúncios (Firecrawl + Claude)
              </div>
            </div>
          </div>

          {selectedProduct && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#E8EDFF]/40 border border-[#2D3277]/20">
              <img src={selectedProduct.image} alt="" className="h-9 w-9 rounded object-cover bg-muted shrink-0" onError={e => { (e.target as HTMLImageElement).style.display="none" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{selectedProduct.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedProduct.mlItemId}</div>
              </div>
              <div className="text-sm font-bold text-[#2D3277] shrink-0">{BRL(currentPrice)}</div>
            </div>
          )}

          <Button className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456] font-semibold" onClick={run} disabled={loading || !selectedId || !keyword.trim()}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{step}</> : <><Search className="h-4 w-4 mr-2" />Analisar concorrentes</>}
          </Button>
        </CardContent>
      </Card>

      {/* ── Debug (só mostra se tiver erro) ───────────────────────────────── */}
      {rawDebug && !result && (
        <Card className="border-dashed border-muted">
          <CardHeader className="pb-1">
            <button className="flex items-center gap-2 text-xs text-muted-foreground" onClick={() => setRawDebug(null)}>
              ✕ Fechar debug
            </button>
            <CardTitle className="text-xs text-muted-foreground">Estrutura do primeiro item Firecrawl (debug)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{rawDebug}</pre>
          </CardContent>
        </Card>
      )}

      {/* ── Análises salvas ───────────────────────────────────────────────── */}
      {savedList.length > 0 && !result && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Análises salvas</CardTitle></CardHeader>
          <CardContent className="p-0">
            {savedList.map(s => (
              <div key={s.key} className="flex items-center gap-3 px-4 py-2.5 border-t hover:bg-muted/30">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{new Date(s.savedAt).toLocaleString("pt-BR")}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => loadSaved(s.key)}>Carregar</Button>
                <button onClick={() => deleteSaved(s.key)} className="text-xs text-red-400 hover:text-red-600">Remover</button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Vazio ─────────────────────────────────────────────────────────── */}
      {!result && !loading && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">Selecione um anúncio e insira a keyword</p>
          <p className="text-sm mt-1">O Firecrawl raspa os concorrentes do Mercado Livre e o Claude analisa os padrões de ranking em JSON estruturado.</p>
        </CardContent></Card>
      )}

      {/* ── Resultado ─────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">"{result.keyword}"</span>
            <Badge className="bg-[#2D3277]/10 text-[#2D3277] border-0">{result.competitors.length} anúncios</Badge>
            <Badge className="bg-green-500/15 text-green-700 border-0">{result.competitors.filter(c => !c.patrocinado).length} orgânicos</Badge>
            <Badge className="bg-yellow-400/20 text-yellow-700 border-0">{result.competitors.filter(c => c.patrocinado).length} patrocinados</Badge>
            {result.analise.dificuldade && (
              <Badge className={`border-0 ${DIFF_COLOR[result.analise.dificuldade] || "bg-muted"}`}>
                {result.analise.dificuldade}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{new Date(result.savedAt).toLocaleString("pt-BR")}</span>
            <Button size="sm" variant="outline" onClick={run} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Refazer
            </Button>
          </div>

          {/* ── Tabela Firecrawl ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowRaw(v => !v)}>
                {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <CardTitle className="text-sm">{result.competitors.length} resultados coletados do Mercado Livre</CardTitle>
                <span className="text-xs text-muted-foreground ml-auto">{showRaw ? "ocultar" : "ver tabela"}</span>
              </button>
            </CardHeader>
            {showRaw && (
              <CardContent className="p-0 overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/80 sticky top-0">
                    <tr>
                      {["#","Img","Título","Preço","De","⭐","Frete","Tipo","Link"].map(h => (
                        <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.competitors.map(c => (
                      <tr key={c.posicao} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-1.5 font-mono text-muted-foreground w-6">{c.posicao}</td>
                        <td className="px-3 py-1.5">
                          {c.imagem ? <img src={c.imagem} alt="" className="h-8 w-8 rounded object-cover bg-muted" onError={e => { (e.target as HTMLImageElement).style.display="none" }} />
                                    : <Package className="h-7 w-7 text-muted-foreground/30" />}
                        </td>
                        <td className="px-3 py-1.5 max-w-[200px]">
                          <div className="truncate font-medium" title={c.titulo}>{c.titulo}</div>
                          {c.marca && <div className="text-muted-foreground">{c.marca}</div>}
                        </td>
                        <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{c.preco > 0 ? BRL(c.preco) : "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground line-through whitespace-nowrap">
                          {c.preco_anterior ? BRL(c.preco_anterior) : "—"}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {c.avaliacao != null ? <span className="flex items-center gap-0.5"><Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />{c.avaliacao.toFixed(1)}</span> : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {c.frete_gratis ? <span className="text-green-700 font-medium">Grátis</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {c.patrocinado ? <span className="text-yellow-700 font-medium">Patrocinado</span> : <span className="text-blue-700">Orgânico</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800"><ExternalLink className="h-3.5 w-3.5" /></a>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            )}
          </Card>

          {/* Tabs */}
          <div className="flex gap-0 flex-wrap border-b">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${activeTab === tab.id ? "border-[#2D3277] text-[#2D3277]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* ── TAB: RANKING ──────────────────────────────────────────────── */}
          {activeTab === "ranking" && (() => {
            const a = result.analise
            return (
              <div className="space-y-4">

                {/* KPIs rápidos */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard label="Score oportunidade" value={`${a.score_oportunidade}/100`}
                    color={a.score_oportunidade >= 70 ? "green" : a.score_oportunidade >= 40 ? "yellow" : "red"} />
                  <KpiCard label="Preço médio top 5" value={BRL(a.fatores_conversao.preco_medio_top5)} />
                  <KpiCard label="Frete grátis" value={`${a.fatores_conversao.frete_gratis_pct}%`}
                    color={a.fatores_conversao.frete_gratis_pct >= 70 ? "red" : "green"} />
                  <KpiCard label="Avaliação mín. top 10" value={`${a.social_proof.avaliacoes_minimo_top10 || "—"}★`} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Padrões de título */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart2 className="h-4 w-4" />Padrões de Título</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">Estrutura dominante</div>
                        <div className="text-sm font-medium bg-[#E8EDFF]/60 px-3 py-2 rounded">{a.padroes_titulo.estrutura_dominante}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">Keywords mais frequentes (top 10)</div>
                        <div className="flex flex-wrap gap-1.5">
                          {a.padroes_titulo.keywords_frequentes.map(k => (
                            <span key={k} className="text-xs px-2 py-0.5 bg-[#2D3277]/10 text-[#2D3277] rounded-full font-medium">{k}</span>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-muted/50 rounded p-2"><div className="text-xs text-muted-foreground">Mín</div><div className="font-bold text-sm">{a.padroes_titulo.comprimento_min}</div></div>
                        <div className="bg-muted/50 rounded p-2"><div className="text-xs text-muted-foreground">Médio</div><div className="font-bold text-sm">{a.padroes_titulo.comprimento_medio}</div></div>
                        <div className="bg-muted/50 rounded p-2"><div className="text-xs text-muted-foreground">Máx</div><div className="font-bold text-sm">{a.padroes_titulo.comprimento_max}</div></div>
                      </div>
                      {a.padroes_titulo.palavras_evitar?.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">⚠ Palavras a evitar</div>
                          <div className="flex flex-wrap gap-1">
                            {a.padroes_titulo.palavras_evitar.map(p => (
                              <span key={p} className="text-xs px-2 py-0.5 bg-red-500/10 text-red-700 rounded-full">{p}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Fatores de conversão + social proof */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />Preço & Conversão</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <DRow label="Faixa de preço top 5" value={`${BRL(a.fatores_conversao.preco_min_top5)} — ${BRL(a.fatores_conversao.preco_max_top5)}`} />
                      <DRow label="Preço médio top 5"   value={BRL(a.fatores_conversao.preco_medio_top5)} />
                      <DRow label="Preço mediano"       value={BRL(a.fatores_conversao.preco_mediano)} />
                      <DRow label="Frete grátis"        value={`${a.fatores_conversao.frete_gratis_pct}%`}
                        color={a.fatores_conversao.frete_gratis_pct >= 70 ? "red" : undefined} />
                      <DRow label="Desconto exibido"    value={`${a.fatores_conversao.desconto_exibido_pct}%`} />
                      <hr className="border-border" />
                      <DRow label="Avaliação média top 5"   value={`${a.social_proof.avaliacoes_media_top5}★`} />
                      <DRow label="Mín. avaliações top 10"  value={`${a.social_proof.avaliacoes_minimo_top10}★`} />
                      {a.social_proof.correlacao_avaliacao_posicao && (
                        <p className="text-xs text-muted-foreground pt-1">{a.social_proof.correlacao_avaliacao_posicao}</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Oportunidades + Quick Wins */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="h-4 w-4 text-yellow-500" />Oportunidades identificadas</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {a.oportunidades.map((o, i) => (
                        <div key={i} className="flex gap-2 text-sm">
                          <span className="text-yellow-500 shrink-0">◆</span><span>{o}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-blue-500" />Quick Wins (ação imediata)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {a.quick_wins.map((q, i) => (
                        <div key={i} className="flex gap-2 text-sm">
                          <span className="bg-blue-500/10 text-blue-700 font-bold rounded-full h-5 w-5 flex items-center justify-center shrink-0 text-xs">{i+1}</span>
                          <span>{q}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>

                {/* Diagnóstico do produto */}
                {a.diagnostico_produto && (
                  <Card className="border-orange-200/60">
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-orange-500" />Diagnóstico do seu anúncio</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted/50 rounded-lg p-3 text-center">
                          <div className="text-xs text-muted-foreground">Score atual</div>
                          <div className={`text-2xl font-black ${a.diagnostico_produto.score_atual >= 60 ? "text-green-700" : a.diagnostico_produto.score_atual >= 40 ? "text-yellow-700" : "text-red-700"}`}>
                            {a.diagnostico_produto.score_atual}/100
                          </div>
                        </div>
                        <div className="bg-[#E8EDFF]/60 rounded-lg p-3 text-center">
                          <div className="text-xs text-muted-foreground">Score potencial</div>
                          <div className="text-2xl font-black text-[#2D3277]">{a.diagnostico_produto.score_potencial}/100</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">Principais problemas (ordenados por impacto):</div>
                        {a.diagnostico_produto.principais_problemas.map((p, i) => (
                          <div key={i} className="flex gap-2 text-sm py-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" /><span>{p}</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1.5">Gap vs top 3:</div>
                        {a.diagnostico_produto.gap_vs_top3.map((g, i) => (
                          <div key={i} className="flex gap-2 text-sm py-0.5">
                            <span className="text-muted-foreground shrink-0">→</span><span>{g}</span>
                          </div>
                        ))}
                      </div>
                      {/* Títulos top 5 */}
                      {a.padroes_titulo.titulos_top5?.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1.5">Títulos dos top 5 concorrentes:</div>
                          {a.padroes_titulo.titulos_top5.map((t, i) => (
                            <div key={i} className="flex gap-2 text-xs py-1 border-b last:border-0">
                              <span className="text-[#2D3277] font-bold shrink-0">#{i+1}</span>
                              <span className="text-foreground">{t}</span>
                              <span className="text-muted-foreground ml-auto shrink-0">{t.length}c</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          })()}

          {/* ── TAB: TÍTULOS ──────────────────────────────────────────────── */}
          {activeTab === "titles" && (
            <div className="space-y-3">
              {!result.conteudo.titulos?.length && (
                <Card><CardContent className="py-8 text-center text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2" />Títulos não gerados. Tente refazer a análise.
                </CardContent></Card>
              )}
              {result.conteudo.titulos?.map((t, i) => (
                <Card key={i} className={i === 0 ? "border-[#2D3277]/40" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {i === 0 && <Badge className="bg-[#2D3277] text-[#FFE600] border-0 text-xs">Recomendado</Badge>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${t.score >= 80 ? "bg-green-500/15 text-green-700" : t.score >= 60 ? "bg-yellow-400/20 text-yellow-700" : "bg-red-500/15 text-red-700"}`}>
                          Score {t.score}/100
                        </span>
                        <span className={`text-xs font-mono ${t.caracteres > 60 ? "text-red-600" : t.caracteres >= 50 ? "text-green-600" : "text-yellow-600"}`}>
                          {t.caracteres}/60 chars
                        </span>
                      </div>
                      <CopyBtn text={t.texto} id={`t${i}`} copied={copied} onCopy={copy} />
                    </div>
                    <p className="font-semibold text-base mb-2 border-l-2 border-[#2D3277] pl-3">{t.texto}</p>
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {t.keywords?.map(k => <span key={k} className="text-xs px-2 py-0.5 bg-muted rounded-full">{k}</span>)}
                    </div>
                    {t.estrategia && <p className="text-xs text-muted-foreground"><strong className="text-foreground">Estratégia:</strong> {t.estrategia}</p>}
                    {t.por_que    && <p className="text-xs text-muted-foreground mt-0.5"><strong className="text-foreground">Por quê rankeia:</strong> {t.por_que}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ── TAB: DESCRIÇÃO ────────────────────────────────────────────── */}
          {activeTab === "description" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <CopyBtn text={result.conteudo.descricao_markdown || ""} id="desc-md" copied={copied} onCopy={copy} label="Copiar Markdown" />
                <CopyBtn text={result.conteudo.descricao_texto || ""} id="desc-txt" copied={copied} onCopy={copy} label="Copiar Texto Plano" />
              </div>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Versão Markdown</CardTitle></CardHeader>
                <CardContent>
                  <SimpleMarkdown text={result.conteudo.descricao_markdown || ""} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Versão Texto Plano (copiar direto no ML)</CardTitle></CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap leading-relaxed">{result.conteudo.descricao_texto}</pre>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── TAB: KEYWORDS ─────────────────────────────────────────────── */}
          {activeTab === "keywords" && (
            <div className="space-y-4">
              {/* Longtails */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Longtails ({result.conteudo.longtails?.length || 0})</CardTitle>
                    <CopyBtn text={result.conteudo.longtails?.map(l => l.termo).join("\n") || ""} id="longtails" copied={copied} onCopy={copy} />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        {["Termo","Volume","Intenção"].map(h => <th key={h} className="text-left font-medium px-3 py-2">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.conteudo.longtails?.map((l, i) => (
                        <tr key={i} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{l.termo}</td>
                          <td className="px-3 py-2"><Badge className={`border-0 text-xs ${VOL_COLOR[l.volume] || "bg-muted"}`}>{l.volume}</Badge></td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">{l.intencao}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <KwCard title="Variações semânticas" items={result.conteudo["variações_semanticas"]} copyId="var" copied={copied} onCopy={copy} />
                <KwCard title="Atributos técnicos buscados" items={result.conteudo.atributos_tecnicos} copyId="attr" copied={copied} onCopy={copy} />
                <KwCard title="Autocomplete (como buscam)" items={result.conteudo.autocomplete} copyId="auto" copied={copied} onCopy={copy} color="blue" />
                <KwCard title="Termos negativos (evitar)" items={result.conteudo.termos_negativos} copyId="neg" copied={copied} onCopy={copy} color="red" />
              </div>
            </div>
          )}

          {/* ── TAB: Q&A ──────────────────────────────────────────────────── */}
          {activeTab === "qa" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <CopyBtn
                  text={result.conteudo.qa?.map(q => `P: ${q.pergunta}\nR: ${q.resposta}`).join("\n\n") || ""}
                  id="qa-all" copied={copied} onCopy={copy} label="Copiar todos" />
              </div>
              {result.conteudo.qa?.map((q, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-sm">P{i+1}: {q.pergunta}</p>
                      <CopyBtn text={`P: ${q.pergunta}\nR: ${q.resposta}`} id={`qa${i}`} copied={copied} onCopy={copy} />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{q.resposta}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ── TAB: RELATÓRIO ────────────────────────────────────────────── */}
          {activeTab === "report" && (
            <div className="space-y-4">
              {/* Resumo executivo */}
              <Card className="border-[#2D3277]/20 bg-[#E8EDFF]/20">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-[#2D3277]" />Resumo Executivo</CardTitle></CardHeader>
                <CardContent><p className="text-sm leading-relaxed">{result.conteudo.resumo_executivo}</p></CardContent>
              </Card>

              {/* Top 3 descobertas */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top 3 Descobertas</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {result.conteudo.top3_descobertas?.map((d, i) => (
                    <div key={i} className="flex gap-3 p-3 bg-muted/40 rounded-lg">
                      <span className="font-black text-[#2D3277] text-lg shrink-0">{i+1}</span>
                      <span className="text-sm">{d}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Plano de ação */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Plano de Ação (Impacto × Esforço)</CardTitle>
                    <CopyBtn
                      text={result.conteudo.plano_acao?.map(p => `${p.acao} | Impacto: ${p.impacto} | Esforço: ${p.esforco} | Prazo: ${p.prazo}`).join("\n") || ""}
                      id="plano" copied={copied} onCopy={copy} />
                  </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>{["Ação","Impacto","Esforço","Prazo","Resp."].map(h => <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.conteudo.plano_acao?.map((p, i) => (
                        <tr key={i} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{p.acao}</td>
                          <td className="px-3 py-2"><span className={`font-semibold ${IMP_COLOR[p.impacto] || ""}`}>{p.impacto}</span></td>
                          <td className="px-3 py-2 text-muted-foreground">{p.esforco}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{p.prazo}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.responsavel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Métricas + próximos passos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Métricas para acompanhar (30d)</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5">
                    {result.conteudo.metricas_30d?.map((m, i) => (
                      <div key={i} className="flex gap-2 text-sm"><span className="text-[#2D3277] shrink-0">●</span>{m}</div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 5 passos</CardTitle></CardHeader>
                  <CardContent className="space-y-1.5">
                    {result.conteudo.proximos_passos?.map((p, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        <span className="bg-[#2D3277] text-[#FFE600] font-bold rounded-full h-5 w-5 flex items-center justify-center shrink-0 text-xs">{i+1}</span>
                        {p}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string; color?: "green"|"yellow"|"red" }) {
  const cls = color === "green" ? "text-green-700" : color === "yellow" ? "text-yellow-700" : color === "red" ? "text-red-700" : ""
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
    </CardContent></Card>
  )
}

function DRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center text-xs gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`font-semibold text-right ${color ? "text-red-700" : ""}`}>{value}</span>
    </div>
  )
}

function CopyBtn({ text, id, copied, onCopy, label }: { text: string; id: string; copied: string|null; onCopy: (t:string,k:string)=>void; label?: string }) {
  return (
    <button onClick={() => onCopy(text, id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {copied === id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied === id ? "Copiado!" : (label || "Copiar")}
    </button>
  )
}

function KwCard({ title, items, copyId, copied, onCopy, color }: { title: string; items?: string[]; copyId: string; copied: string|null; onCopy: (t:string,k:string)=>void; color?: "red"|"blue" }) {
  const cls = color === "red" ? "bg-red-500/10 text-red-700" : color === "blue" ? "bg-blue-500/10 text-blue-700" : "bg-muted text-foreground"
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CopyBtn text={(items||[]).join("\n")} id={copyId} copied={copied} onCopy={onCopy} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-1.5">
        {(items||[]).map((item, i) => <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{item}</span>)}
      </CardContent>
    </Card>
  )
}

function SimpleMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("## "))  return <h2 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(3)}</h2>
        if (line.startsWith("### ")) return <h3 key={i} className="text-sm font-semibold mt-2">{line.slice(4)}</h3>
        if (line.startsWith("✓ "))   return <div key={i} className="flex gap-2 text-green-700"><span className="shrink-0">✓</span><span>{line.slice(2)}</span></div>
        if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">•</span><span>{line.slice(2)}</span></div>
        if (!line.trim()) return <div key={i} className="h-1" />
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return <p key={i}>{parts.map((p,j) => p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2,-2)}</strong> : p)}</p>
      })}
    </div>
  )
}
