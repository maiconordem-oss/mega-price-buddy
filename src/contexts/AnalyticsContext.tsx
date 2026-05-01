/**
 * AnalyticsContext — busca centralizada de visitas + pedidos (90 dias)
 *
 * Persistência em 2 camadas:
 * 1. Cloudflare KV (servidor) — fonte de verdade, compartilhada entre dispositivos
 * 2. localStorage (cliente)   — cache síncrono para abertura instantânea (zero spinner)
 *
 * TTL: 6 horas em ambas as camadas.
 */

import {
  createContext, useContext, useState, useCallback,
  useRef, useEffect, type ReactNode,
} from 'react'
import { ml, serverSave, serverLoad, toMLDate, chunks, fetchAllOrders, getUserId } from '@/services/ml-api'
import { kvSave, kvLoad } from '@/server/kv'
import { useAuth } from './AuthContext'
import { useProducts } from './ProductsContext'
import { useShopReset } from '@/hooks/useShopReset'
import { toast } from 'sonner'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface OrderItem {
  mlItemId:  string
  quantity:  number
  unitPrice: number
  title:     string
}

export interface Order {
  id:            number
  dateCreated:   string
  buyerNickname: string
  total:         number
  status:        string
  items:         OrderItem[]
}

export interface VisitData { [mlItemId: string]: number }
export interface OrderData { [mlItemId: string]: { qty: number; revenue: number } }

interface CachePayload {
  visitMap:  VisitData
  orderMap:  OrderData
  allOrders: Order[]
  fetchedAt: string
}

interface Ctx {
  visitMap:  VisitData
  orderMap:  OrderData
  allOrders: Order[]
  loading:   boolean
  loaded:    boolean
  lastFetch: Date | null
  load:      (force?: boolean) => Promise<void>
}

const AnalyticsContext = createContext<Ctx | null>(null)

// ── Constantes ────────────────────────────────────────────────────────────────

const CACHE_KEY     = 'analytics-90d'
const CACHE_TTL_MIN = 360          // 6 horas
const CACHE_TTL_SEC = 360 * 60    // para o KV (expirationTtl em segundos)

// ── Cache localStorage (síncrono) ─────────────────────────────────────────────

function lsKey(shopId: string) {
  return `megalabs:${shopId || 'default'}:${CACHE_KEY}`
}

function readLS(shopId: string): CachePayload | null {
  try {
    const raw = localStorage.getItem(lsKey(shopId))
    if (!raw) return null
    const parsed: { data: CachePayload; ts: string } = JSON.parse(raw)
    if (!parsed?.data || !parsed?.ts) return null
    const ageMin = (Date.now() - new Date(parsed.ts).getTime()) / 60000
    if (ageMin >= CACHE_TTL_MIN) return null
    if (!isValidPayload(parsed.data)) return null  // cache com visitas zeradas → invalida
    return parsed.data
  } catch { return null }
}

function writeLS(shopId: string, payload: CachePayload) {
  try {
    localStorage.setItem(lsKey(shopId), JSON.stringify({
      data: payload,
      ts:   new Date().toISOString(),
    }))
  } catch {}
}

// Valida se o payload tem dados reais (não zerados)
function isValidPayload(p: CachePayload | null): p is CachePayload {
  if (!p) return false
  // Rejeita cache onde todas as visitas são zero (indica busca com falha)
  const visits = Object.values(p.visitMap || {})
  if (visits.length > 0 && visits.every(v => v === 0)) return false
  return true
}

function readLSDate(shopId: string): Date | null {
  try {
    const raw = localStorage.getItem(lsKey(shopId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.ts ? new Date(parsed.ts) : null
  } catch { return null }
}

// ── Cache KV (servidor) ───────────────────────────────────────────────────────

async function readKV(userId: string, shopId: string): Promise<CachePayload | null> {
  try {
    const raw = await kvLoad({ data: { userId, shopId, key: CACHE_KEY } })
    if (!raw) return null
    const parsed: { data: CachePayload; ts: string } = JSON.parse(raw)
    if (!parsed?.data || !parsed?.ts) return null
    const ageMin = (Date.now() - new Date(parsed.ts).getTime()) / 60000
    if (ageMin >= CACHE_TTL_MIN) return null
    if (!isValidPayload(parsed.data)) return null  // cache com visitas zeradas → invalida
    return parsed.data
  } catch { return null }
}

async function writeKV(userId: string, shopId: string, payload: CachePayload) {
  try {
    await kvSave({
      data: {
        userId,
        shopId,
        key:        CACHE_KEY,
        value:      payload,
        ttlSeconds: CACHE_TTL_SEC,
      },
    })
  } catch {}
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { userId, mlConnected, currentShop } = useAuth()
  const { products } = useProducts()
  const shopId = currentShop?.id ?? 'default'

  // Estado inicial: lê localStorage de forma síncrona → zero spinner
  const [visitMap,  setVisitMap]  = useState<VisitData>(() => {
    const c = readLS(shopId); return isValidPayload(c) ? c.visitMap : {}
  })
  const [orderMap,  setOrderMap]  = useState<OrderData>(() => {
    const c = readLS(shopId); return isValidPayload(c) ? c.orderMap : {}
  })
  const [allOrders, setAllOrders] = useState<Order[]>(() => {
    const c = readLS(shopId); return isValidPayload(c) ? c.allOrders : []
  })
  const [lastFetch, setLastFetch] = useState<Date | null>(() => readLSDate(shopId))
  const [loaded,    setLoaded]    = useState<boolean>(() => isValidPayload(readLS(shopId)))
  const [loading,   setLoading]   = useState(false)

  const loadingRef  = useRef(false)
  const initDoneRef = useRef(false)
  const kvSyncedRef = useRef(false)  // evita múltiplos syncs com KV

  function applyPayload(p: CachePayload) {
    setVisitMap(p.visitMap)
    setOrderMap(p.orderMap)
    setAllOrders(p.allOrders)
    setLastFetch(new Date(p.fetchedAt))
    setLoaded(true)
  }

  // ── Reset ao trocar de conta ──────────────────────────────────────────────
  useShopReset(useCallback(() => {
    const newShopId = currentShop?.id ?? 'default'
    const cached = readLS(newShopId)
    if (cached) {
      applyPayload(cached)
      setLastFetch(readLSDate(newShopId))
    } else {
      setVisitMap({}); setOrderMap({}); setAllOrders([])
      setLoaded(false); setLastFetch(null)
    }
    initDoneRef.current = false
    kvSyncedRef.current = false
  }, [currentShop]))

  // ── Sync KV → localStorage quando userId disponível ──────────────────────
  // Se o cache local está vazio mas o KV pode ter dados de outra sessão
  useEffect(() => {
    if (!userId || !mlConnected) return
    if (kvSyncedRef.current) return
    if (loaded) {
      // Já tem dados locais — persiste no KV em background (sem bloquear)
      kvSyncedRef.current = true
      const cached = readLS(shopId)
      if (cached) writeKV(userId, shopId, cached)
      return
    }

    // Não tem local — tenta buscar do KV
    kvSyncedRef.current = true
    readKV(userId, shopId).then(kvData => {
      if (kvData) {
        applyPayload(kvData)
        writeLS(shopId, kvData)  // popula localStorage com dados do KV
        toast.success('Dados carregados do servidor ☁️', { duration: 2000 })
      }
    })
  }, [userId, mlConnected, shopId, loaded])

  // ── Load principal ────────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) {
      toast.info('Conecte o Mercado Livre para carregar os dados.')
      return
    }
    if (loadingRef.current) return

    if (!force) {
      // 1. Memória
      if (loaded && readLS(shopId)) return
      // 2. localStorage
      const ls = readLS(shopId)
      if (ls) { applyPayload(ls); return }
      // 3. KV
      const kv = await readKV(userId, shopId)
      if (kv) { applyPayload(kv); writeLS(shopId, kv); return }
    }

    const mlItems = products.filter(p => p.mlItemId)
    if (!mlItems.length) { toast.info('Carregue os produtos do ML primeiro.'); return }

    loadingRef.current = true
    setLoading(true)

    try {
      const now      = new Date()
      const dateFrom = toMLDate(new Date(now.getTime() - 90 * 86400000))
      const dateTo   = toMLDate(now)
      const itemIds  = mlItems.map(p => p.mlItemId!)

      // ── Visitas: todos os lotes em paralelo (igual promoções) ────────────
      // 1 request por item (API ML não aceita múltiplos IDs)
      // Lotes de 10, todos disparados ao mesmo tempo com jitter de 50ms
      toast.loading(`Buscando visitas (${itemIds.length} produtos)...`, { id: 'analytics' })
      const newVisitMap: VisitData = {}

      const visitBatches: string[][] = []
      for (let i = 0; i < itemIds.length; i += 10) {
        visitBatches.push(itemIds.slice(i, i + 10))
      }

      await Promise.all(visitBatches.map(async (batch, batchIdx) => {
        // Jitter: distribui os lotes para não bater todos no mesmo ms
        await new Promise(r => setTimeout(r, batchIdx * 50))
        await Promise.all(batch.map(async id => {
          try {
            const res = await ml(
              `/visits/items?ids=${id}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
            )
            if (Array.isArray(res)) {
              const found = (res as Array<{ item_id: string; total_visits: number }>).find(r => r.item_id === id)
              newVisitMap[id] = found?.total_visits || 0
            } else {
              const obj = res as Record<string, { total_visits?: number } | number>
              const val = obj[id]
              newVisitMap[id] = typeof val === 'number' ? val : (val as { total_visits?: number })?.total_visits || 0
            }
          } catch { newVisitMap[id] = 0 }
        }))
      }))

      // ── Pedidos (90 dias) ─────────────────────────────────────────────────
      toast.loading('Buscando pedidos (90 dias)...', { id: 'analytics' })
      type RawOI    = { item: { id: string | number; title?: string }; quantity: number; unit_price: number }
      type RawOrder = { id: number; date_created: string; buyer: { nickname: string }; total_amount: number; status: string; order_items: RawOI[] }
      const raw = await fetchAllOrders(userId, 'paid', dateFrom, 40) as RawOrder[]

      const newOrderMap: OrderData = {}
      const newAllOrders: Order[]  = raw.map(o => {
        const items: OrderItem[] = (o.order_items || []).map(oi => {
          const rawId = oi.item?.id
          const id    = rawId ? (String(rawId).startsWith('MLB') ? String(rawId) : `MLB${rawId}`) : ''
          if (id) {
            newOrderMap[id] = newOrderMap[id] || { qty: 0, revenue: 0 }
            newOrderMap[id].qty     += Number(oi.quantity)   || 0
            newOrderMap[id].revenue += (Number(oi.quantity) || 0) * (Number(oi.unit_price) || 0)
          }
          return { mlItemId: id, quantity: Number(oi.quantity) || 0, unitPrice: Number(oi.unit_price) || 0, title: oi.item?.title || '' }
        })
        // total = soma dos itens (unitPrice × qty), NÃO total_amount
        // total_amount inclui frete pago pelo comprador e difere do faturamento real do produto
        const itemsTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
        return { id: o.id, dateCreated: o.date_created, buyerNickname: o.buyer?.nickname || '', total: itemsTotal, status: o.status, items }
      })

      const payload: CachePayload = {
        visitMap:  newVisitMap,
        orderMap:  newOrderMap,
        allOrders: newAllOrders,
        fetchedAt: new Date().toISOString(),
      }

      applyPayload(payload)

      // Persiste em ambas as camadas em paralelo
      writeLS(shopId, payload)
      await Promise.all([
        writeKV(userId, shopId, payload),
        serverSave(CACHE_KEY, payload).catch(() => {}),
      ])

      toast.success(`${itemIds.length} produtos · ${newAllOrders.length} pedidos · 90 dias ☁️`, { id: 'analytics' })

    } catch (e) {
      toast.error('Erro: ' + (e as Error).message, { id: 'analytics' })
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [userId, mlConnected, products, loaded, shopId])

  // ── Auto-load: só busca API se não tem cache em nenhuma camada ────────────
  useEffect(() => {
    if (!mlConnected || !userId || !products.length) return
    if (initDoneRef.current) return
    initDoneRef.current = true
    if (loaded) return  // já carregou do localStorage no useState
    load(false)         // tenta KV → API
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlConnected, userId, products.length])

  return (
    <AnalyticsContext.Provider value={{ visitMap, orderMap, allOrders, loading, loaded, lastFetch, load }}>
      {children}
    </AnalyticsContext.Provider>
  )
}

export function useAnalytics() {
  const ctx = useContext(AnalyticsContext)
  if (!ctx) throw new Error('useAnalytics must be used within AnalyticsProvider')
  return ctx
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function filterOrdersByDays(orders: Order[], days: number): Order[] {
  const cutoff = Date.now() - days * 86400000
  return orders.filter(o => new Date(o.dateCreated).getTime() >= cutoff)
}

export function buildOrderMap(orders: Order[]): OrderData {
  const map: OrderData = {}
  for (const o of orders) {
    for (const oi of o.items) {
      if (!oi.mlItemId) continue
      map[oi.mlItemId] = map[oi.mlItemId] || { qty: 0, revenue: 0 }
      map[oi.mlItemId].qty     += oi.quantity
      map[oi.mlItemId].revenue += oi.quantity * oi.unitPrice
    }
  }
  return map
}
