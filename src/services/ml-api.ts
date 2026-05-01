/**
 * Acesso à API do Mercado Livre.
 *
 * Em produção (Cloudflare Workers): usa server functions — client_secret seguro.
 * Em dev (Vite SPA): tenta direto via CORS (sem client_secret).
 */
import { mlGet, mlMutate, exchangeCodeForToken, refreshAccessToken, getMLAuthUrl } from '@/server/ml-oauth'

export const PROXY_URL = '' // legado — não usado

let _token  = ''
let _shopId = ''

export function setToken(t: string)   { _token  = t }
export function setShopId(id: string) { _shopId = id }
export function getToken()            { return _token }
export function getShopId()           { return _shopId }

// ── Constantes ML (client_id é público por design OAuth) ──────────────────
const ML_CLIENT_ID    = '285337336691848'
const ML_REDIRECT_URI = 'https://mega-price-buddy.lovable.app/auth/callback'
const ML_AUTH_BASE    = 'https://auth.mercadolivre.com.br'
const ML_API_BASE     = 'https://api.mercadolibre.com'

export function getClientId()    { return ML_CLIENT_ID    }
export function getRedirectUri() { return ML_REDIRECT_URI }
export function getAuthBase()    { return ML_AUTH_BASE    }

// ── Endpoints com CORS BLOQUEADO pelo ML (nunca chamar direto do browser) ─
// Qualquer path que comece com esses prefixos vai SEMPRE pelo server function
const CORS_BLOCKED_PREFIXES = [
  '/visits/',
  '/orders/',
  '/seller-promotions/',
  '/pricing-automation/',
  '/marketplace/',
  '/moderations/',
  '/user-products/',
]

function isCorsBlocked(path: string): boolean {
  return CORS_BLOCKED_PREFIXES.some(prefix => path.startsWith(prefix))
}

// ── GET à API ML ───────────────────────────────────────────────────────────
export async function ml(path: string): Promise<unknown> {
  if (!_token) throw new Error('Não autenticado. Conecte o Mercado Livre.')

  if (isCorsBlocked(path)) {
    // NUNCA tentar direto — vai pelo Cloudflare Worker obrigatoriamente
    const text = await mlGet({ data: { path, access_token: _token } })
    return JSON.parse(text)
  }

  // Outros endpoints: tenta server function; fallback CORS apenas se Worker indisponível
  try {
    const text = await mlGet({ data: { path, access_token: _token } })
    return JSON.parse(text)
  } catch {
    const res = await fetch(`${ML_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${_token}` },
    })
    const json: unknown = await res.json()
    if (!res.ok) {
      const e = json as Record<string, string>
      throw new Error(e.message || e.error || `ML HTTP ${res.status}`)
    }
    return json
  }
}

// ── POST/PUT/DELETE à API ML ──────────────────────────────────────────────
export async function proxyPost(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  if (!_token) throw new Error('Não autenticado.')
  // Mutações (POST/PUT/DELETE) SEMPRE via server function — ML bloqueia CORS para mutações
  const text = await mlMutate({
    data: { method, path, access_token: _token, body: body !== undefined ? JSON.stringify(body) : undefined },
  })
  return JSON.parse(text)
}

// ── Exchange code → token ─────────────────────────────────────────────────
export async function exchangeCode(code: string, codeVerifier: string) {
  try {
    // Produção: server function com client_secret
    return await exchangeCodeForToken({ data: { code, code_verifier: codeVerifier } })
  } catch {
    // Dev fallback: PKCE puro sem client_secret
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: ML_CLIENT_ID,
      code, redirect_uri: ML_REDIRECT_URI, code_verifier: codeVerifier,
    })
    const res = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
    const json = await res.json() as Record<string, unknown>
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`))
    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || ''),
      expires_in:    Number(json.expires_in || 21600),
      user_id:       Number(json.user_id || 0),
    }
  }
}

// ── Refresh token ──────────────────────────────────────────────────────────
export async function refreshToken(refresh: string) {
  try {
    return await refreshAccessToken({ data: { refresh_token: refresh } })
  } catch {
    const body = new URLSearchParams({
      grant_type: 'refresh_token', client_id: ML_CLIENT_ID, refresh_token: refresh,
    })
    const res = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    })
    const json = await res.json() as Record<string, unknown>
    if (!res.ok) throw new Error(String(json.message || json.error || `HTTP ${res.status}`))
    return {
      access_token:  String(json.access_token),
      refresh_token: String(json.refresh_token || refresh),
      expires_in:    Number(json.expires_in || 21600),
    }
  }
}

// ── Gera URL de auth ML ────────────────────────────────────────────────────
export async function getAuthUrl(codeChallenge: string): Promise<string> {
  try {
    const { url } = await getMLAuthUrl({ data: { code_challenge: codeChallenge } })
    return url
  } catch {
    const params = new URLSearchParams({
      response_type: 'code', client_id: ML_CLIENT_ID, redirect_uri: ML_REDIRECT_URI,
      code_challenge: codeChallenge, code_challenge_method: 'S256',
    })
    return `${ML_AUTH_BASE}/authorization?${params.toString()}`
  }
}

// ── Persistência: KV no servidor + fallback localStorage ──────────────────
// Chave isolada por userId (ML) + shopId. Se userId vazio, cai no localStorage.
import { kvSave, kvLoad } from '@/server/kv'

let _userId = ''
export function setUserId(id: string) { _userId = id }
export function getUserId() { return _userId }

function storageKey(key: string) { return `megalabs:${_userId || 'anon'}:${_shopId || 'default'}:${key}` }

export async function serverSave(key: string, data: unknown, ttlSeconds?: number): Promise<void> {
  // Sempre grava localStorage (cache rápido / offline)
  try { localStorage.setItem(storageKey(key), JSON.stringify({ data, ts: new Date().toISOString() })) } catch {}
  // Tenta gravar no KV se temos userId
  if (_userId) {
    try { await kvSave({ data: { userId: _userId, shopId: _shopId || 'default', key, value: data, ttlSeconds } }) } catch {}
  }
}

export async function serverLoad<T>(key: string): Promise<{ data: T; ts: string } | null> {
  // 1) Tenta KV (fonte de verdade entre dispositivos)
  if (_userId) {
    try {
      const raw = await kvLoad({ data: { userId: _userId, shopId: _shopId || 'default', key } })
      if (raw) {
        const parsed = JSON.parse(raw) as { data: T; ts: string }
        // Atualiza cache local
        try { localStorage.setItem(storageKey(key), raw) } catch {}
        return parsed
      }
    } catch {}
  }
  // 2) Fallback localStorage
  try {
    const raw = localStorage.getItem(storageKey(key))
    return raw ? JSON.parse(raw) as { data: T; ts: string } : null
  } catch { return null }
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function toMLDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const off  = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs  = Math.abs(off)
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    '.000' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
  )
}

export function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function BRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Busca TODOS os pedidos — primeira página para saber o total, resto em paralelo */
export async function fetchAllOrders(
  userId: string,
  status: string,
  dateFrom: string,
  maxPages = 40,
): Promise<Array<Record<string, unknown>>> {
  const limit = 50

  const buildQs = (offset: number) => [
    `seller=${encodeURIComponent(userId)}`,
    `order.status=${encodeURIComponent(status)}`,
    `sort=date_desc`,
    `limit=${limit}`,
    `offset=${offset}`,
    `order.date_created.from=${encodeURIComponent(dateFrom)}`,
  ].join('&')

  // ── Página 0: descobrir o total ────────────────────────────────────────────
  const first = await ml(`/orders/search?${buildQs(0)}`) as {
    results?: Array<Record<string, unknown>>
    orders?:  Array<Record<string, unknown>>
    paging?:  { total: number }
  }

  const firstResults = first.results ?? first.orders ?? []
  const total        = first.paging?.total ?? firstResults.length

  if (firstResults.length >= total) return firstResults

  // ── Páginas restantes em paralelo ──────────────────────────────────────────
  const offsets: number[] = []
  for (let offset = limit; offset < Math.min(total, maxPages * limit); offset += limit) {
    offsets.push(offset)
  }

  const batchSize = 5 // 5 páginas em paralelo (250 pedidos por wave)
  const rest: Array<Record<string, unknown>> = []

  for (let i = 0; i < offsets.length; i += batchSize) {
    const wave = offsets.slice(i, i + batchSize)
    const results = await Promise.all(wave.map(async offset => {
      const res = await ml(`/orders/search?${buildQs(offset)}`) as {
        results?: Array<Record<string, unknown>>
        orders?:  Array<Record<string, unknown>>
      }
      return res.results ?? res.orders ?? []
    }))
    results.forEach(r => rest.push(...r))

    // Pequeno delay entre waves para não bater rate limit
    if (i + batchSize < offsets.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return [...firstResults, ...rest]
}
