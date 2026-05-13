'use server'

import { createServerFn } from '@tanstack/react-start'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

// ── Persistência server-side via Lovable Cloud (tabela user_storage) ────────
// Substitui o Cloudflare KV. Chave isolada por userId/username + shopId + key.
// Manipulada exclusivamente pelo servidor (admin client) — RLS bloqueia acesso direto.

function buildKey(userId: string, shopId: string, key: string): string {
  const u = userId || 'anon'
  const s = shopId || 'default'
  return `${u}:${s}:${key}`
}

// userId aqui é tratado como "username" (chave lógica do usuário no app).
// A coluna `username` da tabela recebe esse valor, e `key` recebe shopId:key
// para manter o mesmo isolamento que o KV tinha.
function splitForRow(userId: string, shopId: string, key: string) {
  return {
    username: userId || 'anon',
    rowKey: `${shopId || 'default'}:${key}`,
  }
}

// ── Save ─────────────────────────────────────────────────────────────────────
export const kvSave = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string; value: unknown; ttlSeconds?: number }) => data)
  .handler(async ({ data }) => {
    const { username, rowKey } = splitForRow(data.userId, data.shopId, data.key)
    const payload = { data: data.value, ts: new Date().toISOString() }
    const { error } = await supabaseAdmin
      .from('user_storage')
      .upsert({ username, key: rowKey, value: payload, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
    return { ok: true, key: buildKey(data.userId, data.shopId, data.key) }
  })

// ── Load ─────────────────────────────────────────────────────────────────────
// Retorna JSON serializado como string (compat com a API anterior).
export const kvLoad = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string }) => data)
  .handler(async ({ data }): Promise<string | null> => {
    const { username, rowKey } = splitForRow(data.userId, data.shopId, data.key)
    const { data: row, error } = await supabaseAdmin
      .from('user_storage')
      .select('value')
      .eq('username', username)
      .eq('key', rowKey)
      .maybeSingle()
    if (error) return null
    if (!row) return null
    return JSON.stringify(row.value)
  })

// ── Delete ───────────────────────────────────────────────────────────────────
export const kvDelete = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; key: string }) => data)
  .handler(async ({ data }) => {
    const { username, rowKey } = splitForRow(data.userId, data.shopId, data.key)
    const { error } = await supabaseAdmin
      .from('user_storage')
      .delete()
      .eq('username', username)
      .eq('key', rowKey)
    if (error) return { ok: false }
    return { ok: true }
  })

// ── List (chaves de uma shop) ────────────────────────────────────────────────
export const kvList = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string; shopId: string; prefix?: string }) => data)
  .handler(async ({ data }) => {
    const username = data.userId || 'anon'
    const prefix = `${data.shopId || 'default'}:${data.prefix || ''}`
    const { data: rows, error } = await supabaseAdmin
      .from('user_storage')
      .select('key')
      .eq('username', username)
      .like('key', `${prefix}%`)
      .limit(1000)
    if (error || !rows) return { keys: [] as string[] }
    return { keys: rows.map(r => `${username}:${r.key}`) }
  })
