'use server'

import { createServerFn } from '@tanstack/react-start'

const ML_CLIENT_ID     = '285337336691848'
const ML_CLIENT_SECRET = 'FppbNCTNuvQJfLfpcGcgDIRFQRpVxYTn'
const ML_REDIRECT_URI  = 'https://mega-price-buddy.lovable.app/auth/callback'
const ML_API_BASE      = 'https://api.mercadolibre.com'
const ML_AUTH_BASE     = 'https://auth.mercadolivre.com.br'

// ── Troca code por access_token (PKCE + client_secret no servidor) ─────────
export const exchangeCodeForToken = createServerFn({ method: 'POST' })
  .inputValidator((data: { code: string; code_verifier: string }) => data)
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code:          data.code,
      redirect_uri:  ML_REDIRECT_URI,
      code_verifier: data.code_verifier,
    })

    const res = await fetch(`${ML_API_BASE}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })

    const text = await res.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) } catch { throw new Error(`ML returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`) }
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`))

    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || ''),
      expires_in:    Number(json.expires_in   || 21600),
      user_id:       Number(json.user_id      || 0),
    }
  })

// ── Renova access_token via refresh_token ─────────────────────────────────
export const refreshAccessToken = createServerFn({ method: 'POST' })
  .inputValidator((data: { refresh_token: string }) => data)
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: data.refresh_token,
    })

    const res = await fetch(`${ML_API_BASE}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })

    const text = await res.text()
    let json: Record<string, unknown> = {}
    try { json = JSON.parse(text) } catch { throw new Error(`ML returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`) }
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`))

    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || data.refresh_token),
      expires_in:    Number(json.expires_in || 21600),
    }
  })

// ── Proxy GET para api.mercadolibre.com ───────────────────────────────────
export const mlGet = createServerFn({ method: 'POST' })
  .inputValidator((data: { path: string; access_token: string }) => data)
  .handler(async ({ data }) => {
    const res = await fetch(`${ML_API_BASE}${data.path}`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = `ML HTTP ${res.status}`
      try { const j = JSON.parse(text); msg = String(j.message || j.error || msg) } catch {}
      throw new Error(msg)
    }
    return text
  })

// ── Proxy POST/PUT/DELETE ────────────────────────────────────────────────
export const mlMutate = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    method: 'POST' | 'PUT' | 'DELETE'
    path: string
    access_token: string
    body?: string
  }) => data)
  .handler(async ({ data }) => {
    const res = await fetch(`${ML_API_BASE}${data.path}`, {
      method:  data.method,
      headers: {
        Authorization:  `Bearer ${data.access_token}`,
        'Content-Type': 'application/json',
      },
      body: data.body,
    })
    if (res.status === 204) return '{"ok":true}'
    const text = await res.text()
    if (!res.ok) {
      let msg = `ML HTTP ${res.status}`
      try { const j = JSON.parse(text); msg = String(j.message || j.error || msg) } catch {}
      throw new Error(msg)
    }
    return text
  })

// ── Gera URL de autorização ───────────────────────────────────────────────
export const getMLAuthUrl = createServerFn({ method: 'POST' })
  .inputValidator((data: { code_challenge: string }) => data)
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             ML_CLIENT_ID,
      redirect_uri:          ML_REDIRECT_URI,
      code_challenge:        data.code_challenge,
      code_challenge_method: 'S256',
    })
    return { url: `${ML_AUTH_BASE}/authorization?${params.toString()}` }
  })

// ── Proxy Firecrawl — raspa resultados do ML sem CORS ────────────────────────
// FIRECRAWL_API_KEY injetada pelo Lovable App Connector ou wrangler secret
export const firecrawlScrape = createServerFn({ method: 'POST' })
  .inputValidator((data: { keyword: string; pages: number }) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY não configurada. Configure o App Connector do Firecrawl no Lovable ou adicione como wrangler secret.')

    const keyword = data.keyword.trim().replace(/\s+/g, '-')
    const allProducts: Record<string, unknown>[] = []

    for (let page = 1; page <= data.pages; page++) {
      const offset = (page - 1) * 48
      const url = page === 1
        ? `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}`
        : `https://lista.mercadolivre.com.br/${encodeURIComponent(keyword)}_Desde_${offset + 1}_NoIndex_True`

      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ['extract'],
          extract: {
            schema: {
              type: 'object',
              properties: {
                products: {
                  type: 'array',
                  description: 'Lista de produtos da página de busca do Mercado Livre',
                  items: {
                    type: 'object',
                    properties: {
                      title:          { type: 'string',  description: 'Título completo do anúncio' },
                      price:          { type: 'number',  description: 'Preço atual em reais' },
                      original_price: { type: 'number',  description: 'Preço anterior/riscado se houver' },
                      url:            { type: 'string',  description: 'URL completa do anúncio' },
                      rating:         { type: 'number',  description: 'Avaliação média de 0 a 5' },
                      reviews_count:  { type: 'number',  description: 'Número total de avaliações' },
                      is_sponsored:   { type: 'boolean', description: 'Se é anúncio patrocinado ou publicidade' },
                      free_shipping:  { type: 'boolean', description: 'Se tem frete grátis' },
                      condition:      { type: 'string',  description: 'Novo ou Usado' },
                      brand:          { type: 'string',  description: 'Marca do produto se visível' },
                    },
                    required: ['title', 'price', 'url'],
                  },
                },
              },
              required: ['products'],
            },
          },
        }),
      })

      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Firecrawl HTTP ${res.status}: ${t.slice(0, 300)}`)
      }

      type FirecrawlResp = { success: boolean; data?: { extract?: { products?: Record<string, unknown>[] } } }
      const json = await res.json() as FirecrawlResp
      const prods = json.data?.extract?.products || []

      prods.forEach((p, i) => {
        allProducts.push({
          zProdutoNome:       p.title,
          zProdutoLink:       p.url,
          zProdutoPrecoNovo:  p.price,
          zProdutoPrecoPrevio: p.original_price || null,
          zProdutoEstrelas:   p.rating    || null,
          zProdutoCondicao:   p.condition || 'Novo',
          zProdutoMarca:      p.brand     || '',
          zProdutoDescricao:  '',
          ranking_position:   offset + i + 1,
          is_sponsored:       p.is_sponsored  || false,
          free_shipping:      p.free_shipping || false,
          reviews_count:      p.reviews_count || 0,
        })
      })
    }

    if (!allProducts.length) throw new Error('Firecrawl não retornou produtos. Verifique a keyword e tente novamente.')
    return JSON.stringify(allProducts)
  })

// ── Proxy Claude API — evita CORS + guarda API key no servidor ───────────────
export const claudeAnalyze = createServerFn({ method: 'POST' })
  .inputValidator((data: { apiKey: string; prompt: string; maxTokens: number }) => data)
  .handler(async ({ data }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         data.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: data.maxTokens,
        messages:   [{ role: 'user', content: data.prompt }],
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = `Claude API HTTP ${res.status}`
      try { const j = JSON.parse(text); msg = String(j.error?.message || msg) } catch {}
      throw new Error(msg)
    }
    return text // JSON string da resposta
  })
