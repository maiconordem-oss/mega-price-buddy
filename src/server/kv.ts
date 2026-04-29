'use server'

import { createServerFn } from '@tanstack/react-start'

// ── Cloudflare KV binding ────────────────────────────────────────────────────
// O binding "MEGALABS_KV" é declarado em wrangler.jsonc.
// Em Workers, fica disponível via process.env.MEGALABS_KV (nodejs_compat) OU
// via globalThis. Tentamos ambos para máxima compatibilidade.

interface KVNamespace {
  get(key: string, type?: 'text' | 'json'): Promise<string | null>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>
    list_complete: boolean
    cursor?: string
  }>
}

function getKV(): KVNamespace | null {
  // Cloudflare Workers expõe o binding via process.env (com nodejs_compat)
  // e também via globalThis
  const fromEnv = (process.env as unknown as Record<string, KVNamespace | undefined>).MEGALABS_KV
  if (fromEnv && typeof fromEnv.get === 'function') return fromEnv
  const fromGlobal = (globalThis as unknown as Record<string, KVNamespace | undefined>).MEGALABS_KV
  if (fromGlobal && typeof fromGlobal.get === 'function') return fromGlobal
  return null
}

// Compõe chave isolada por conta: userId:shopId:key
function buildKey(userId: string, shopId: string, key: string): string {
  const u = userId || 'anon'
  const s = shopId || 'default'
  return `${u}:${s}:${key}`
}

// ── Save ─────────────────────────────────────────────────────────────────────
export const kvSave = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string; value: unknown; ttlSeconds?: number }) => data)
  .handler(async ({ data }) => {
    const kv = getKV()
    if (!kv) throw new Error('KV namespace MEGALABS_KV não está configurado')
    const fullKey = buildKey(data.userId, data.shopId, data.key)
    const payload = JSON.stringify({ data: data.value, ts: new Date().toISOString() })
    await kv.put(fullKey, payload, data.ttlSeconds ? { expirationTtl: data.ttlSeconds } : undefined)
    return { ok: true, key: fullKey }
  })

// ── Load ─────────────────────────────────────────────────────────────────────
export const kvLoad = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string }) => data)
  .handler(async ({ data }) => {
    const kv = getKV()
    if (!kv) return null
    const fullKey = buildKey(data.userId, data.shopId, data.key)
    const raw = await kv.get(fullKey, 'text')
    if (!raw) return null
    try {
      return JSON.parse(raw) as { data: unknown; ts: string }
    } catch {
      return null
    }
  })

// ── Delete ───────────────────────────────────────────────────────────────────
export const kvDelete = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string }) => data)
  .handler(async ({ data }) => {
    const kv = getKV()
    if (!kv) return { ok: false }
    const fullKey = buildKey(data.userId, data.shopId, data.key)
    await kv.delete(fullKey)
    return { ok: true }
  })

// ── List (chaves de uma shop) ────────────────────────────────────────────────
export const kvList = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; prefix?: string }) => data)
  .handler(async ({ data }) => {
    const kv = getKV()
    if (!kv) return { keys: [] as string[] }
    const prefix = `${data.userId || 'anon'}:${data.shopId || 'default'}:${data.prefix || ''}`
    const res = await kv.list({ prefix, limit: 1000 })
    return { keys: res.keys.map(k => k.name) }
  })
