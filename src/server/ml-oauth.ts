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

    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    const json = await res.json() as Record<string, unknown>
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

    const res = await fetch(`${ML_AUTH_BASE}/jms/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    const json = await res.json() as Record<string, unknown>
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
