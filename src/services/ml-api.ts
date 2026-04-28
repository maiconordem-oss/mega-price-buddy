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

// ── GET à API ML ───────────────────────────────────────────────────────────
export async function ml(path: string): Promise<unknown> {
  if (!_token) throw new Error('Não autenticado. Conecte o Mercado Livre.')
  try {
    // Produção: server function (Cloudflare Worker)
    const text = await mlGet({ data: { path, access_token: _token } })
    return JSON.parse(text)
  } catch (serverErr) {
    // Dev fallback: direto via CORS
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
  try {
    const text = await mlMutate({
      data: { method, path, access_token: _token, body: body !== undefined ? JSON.stringify(body) : undefined },
    })
    return JSON.parse(text)
  } catch {
    // Dev fallback
    const res = await fetch(`${ML_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${_token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return { ok: true }
    const json: unknown = await res.json()
    if (!res.ok) {
      const e = json as Record<string, string>
      throw new Error(e.message || e.error || `ML HTTP ${res.status}`)
    }
    return json
  }
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

// ── Persistência local ─────────────────────────────────────────────────────
function storageKey(key: string) { return `megalabs:${_shopId || 'default'}:${key}` }

export async function serverSave(key: string, data: unknown): Promise<void> {
  try { localStorage.setItem(storageKey(key), JSON.stringify({ data, ts: new Date().toISOString() })) } catch {}
}
export async function serverLoad<T>(key: string): Promise<{ data: T; ts: string } | null> {
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
