/**
 * AnalyticsContext — busca centralizada de visitas + pedidos (90 dias)
 * Cache persistente: 6h no localStorage.
 * Carregamento SÍNCRONO do cache no estado inicial — zero spinner ao abrir.
 */

import {
  createContext, useContext, useState, useCallback,
  useRef, useEffect, type ReactNode,
} from 'react'
import { ml, serverSave, toMLDate, chunks, fetchAllOrders } from '@/services/ml-api'
import { useAuth } from './AuthContext'
import { useProducts } from './ProductsContext'
import { useShopReset } from '@/hooks/useShopReset'
import { toast } from 'sonner'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface OrderItem {
  mlItemId:  string
  quantity:  number
  unitPrice: number
  title:     string
}

export interface Order {
  id:             number
  dateCreated:    string
  buyerNickname:  string
  total:          number
  status:         string
  items:          OrderItem[]
}

export interface VisitData  { [mlItemId: string]: number }
export interface OrderData  { [mlItemId: string]: { qty: number; revenue: number } }

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

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MIN = 360  // 6 horas

interface CachePayload {
  visitMap:  VisitData
  orderMap:  OrderData
  allOrders: Order[]
  fetchedAt: string
}

// Lê cache do localStorage de forma SÍNCRONA (sem await)
// Chama antes do primeiro render para não mostrar spinner
function readCacheSync(shopId: string, key: string): CachePayload | null {
  try {
    const raw = localStorage.getItem(`megalabs:${shopId || 'default'}:${key}`)
    if (!raw) return null
    const parsed: { data: CachePayload; ts: string } = JSON.parse(raw)
    if (!parsed?.data || !parsed?.ts) return null
    const ageMin = (Date.now() - new Date(parsed.ts).getTime()) / 60000
    if (ageMin >= CACHE_TTL_MIN) return null
    return parsed.data
  } catch { return null }
}

function writeCacheSync(shopId: string, key: string, payload: CachePayload) {
  try {
    localStorage.setItem(
      `megalabs:${shopId || 'default'}:${key}`,
      JSON.stringify({ data: payload, ts: new Date().toISOString() })
    )
  } catch {}
}

const CACHE_KEY = 'analytics-90d'

// ── Provider ──────────────────────────────────────────────────────────────────

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { userId, mlConnected, currentShop } = useAuth()
  const { products } = useProducts()
  const shopId = currentShop?.id ?? 'default'

  // ── Estado inicial: tenta carregar do cache ANTES do primeiro render ──────
  const [visitMap,  setVisitMap]  = useState<VisitData>(() => {
    const c = readCacheSync(shopId, CACHE_KEY)
    return c?.visitMap ?? {}
  })
  const [orderMap,  setOrderMap]  = useState<OrderData>(() => {
    const c = readCacheSync(shopId, CACHE_KEY)
    return c?.orderMap ?? {}
  })
  const [allOrders, setAllOrders] = useState<Order[]>(() => {
    const c = readCacheSync(shopId, CACHE_KEY)
    return c?.allOrders ?? []
  })
  const [lastFetch, setLastFetch] = useState<Date | null>(() => {
    try {
      const raw = localStorage.getItem(`megalabs:${shopId}:${CACHE_KEY}`)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed?.ts ? new Date(parsed.ts) : null
    } catch { return null }
  })
  const [loaded,  setLoaded]  = useState<boolean>(() => {
    return readCacheSync(shopId, CACHE_KEY) !== null
  })
  const [loading, setLoading] = useState(false)

  const loadingRef  = useRef(false)
  const initDoneRef = useRef(false)

  // ── Reset ao trocar de conta — recarrega cache da nova conta ─────────────
  useShopReset(useCallback(() => {
    // Tenta carregar cache da nova conta imediatamente
    const newShopId = currentShop?.id ?? 'default'
    const cached = readCacheSync(newShopId, CACHE_KEY)
    if (cached) {
      setVisitMap(cached.visitMap)
      setOrderMap(cached.orderMap)
      setAllOrders(cached.allOrders)
      setLoaded(true)
      try {
        const raw = localStorage.getItem(`megalabs:${newShopId}:${CACHE_KEY}`)
        const parsed = raw ? JSON.parse(raw) : null
        setLastFetch(parsed?.ts ? new Date(parsed.ts) : null)
      } catch {}
    } else {
      setVisitMap({}); setOrderMap({}); setAllOrders([])
      setLoaded(false); setLastFetch(null)
    }
    initDoneRef.current = false
  }, [currentShop]))

  function applyPayload(p: CachePayload) {
    setVisitMap(p.visitMap)
    setOrderMap(p.orderMap)
    setAllOrders(p.allOrders)
    setLastFetch(new Date(p.fetchedAt))
    setLoaded(true)
  }

  // ── Fetch completo da API ─────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) {
      toast.info('Conecte o Mercado Livre para carregar os dados.')
      return
    }
    if (loadingRef.current) return

    // Sem force: se já está em memória e cache ainda válido, não faz nada
    if (!force && loaded) {
      const cached = readCacheSync(shopId, CACHE_KEY)
      if (cached) return
    }

    const mlItems = products.filter(p => p.mlItemId)
    if (!mlItems.length) {
      toast.info('Carregue os produtos do ML primeiro.')
      return
    }

    loadingRef.current = true
    setLoading(true)

    try {
      const now      = new Date()
      const dateFrom = toMLDate(new Date(now.getTime() - 90 * 86400000))
      const dateTo   = toMLDate(now)
      const itemIds  = mlItems.map(p => p.mlItemId!)

      // ── 1. Visitas ────────────────────────────────────────────────────────
      toast.loading(`Buscando visitas (${itemIds.length} produtos)...`, { id: 'analytics' })
      const newVisitMap: VisitData = {}

      for (const batch of chunks(itemIds, 8)) {
        await Promise.all(batch.map(async id => {
          try {
            const res = await ml(
              `/visits/items?ids=${id}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
            )
            if (Array.isArray(res)) {
              const found = (res as Array<{ item_id: string; total_visits: number }>)
                .find(r => r.item_id === id)
              newVisitMap[id] = found?.total_visits || 0
            } else {
              const obj = res as Record<string, { total_visits?: number } | number>
              const val = obj[id]
              newVisitMap[id] = typeof val === 'number'
                ? val
                : (val as { total_visits?: number })?.total_visits || 0
            }
          } catch { newVisitMap[id] = 0 }
        }))
        await new Promise(r => setTimeout(r, 200))
      }

      // ── 2. Pedidos ────────────────────────────────────────────────────────
      toast.loading('Buscando pedidos (90 dias)...', { id: 'analytics' })

      type RawOI = { item: { id: string | number; title?: string }; quantity: number; unit_price: number }
      type RawOrder = { id: number; date_created: string; buyer: { nickname: string }; total_amount: number; status: string; order_items: RawOI[] }

      const raw = await fetchAllOrders(userId, 'paid', dateFrom, 40) as RawOrder[]

      const newOrderMap: OrderData = {}
      const newAllOrders: Order[]  = raw.map(o => {
        const items: OrderItem[] = (o.order_items || []).map(oi => {
          const rawId = oi.item?.id
          const id    = rawId
            ? (String(rawId).startsWith('MLB') ? String(rawId) : `MLB${rawId}`)
            : ''
          if (id) {
            newOrderMap[id] = newOrderMap[id] || { qty: 0, revenue: 0 }
            newOrderMap[id].qty     += Number(oi.quantity)   || 0
            newOrderMap[id].revenue += (Number(oi.quantity) || 0) * (Number(oi.unit_price) || 0)
          }
          return { mlItemId: id, quantity: Number(oi.quantity) || 0, unitPrice: Number(oi.unit_price) || 0, title: oi.item?.title || '' }
        })
        return { id: o.id, dateCreated: o.date_created, buyerNickname: o.buyer?.nickname || '', total: Number(o.total_amount) || 0, status: o.status, items }
      })

      const payload: CachePayload = {
        visitMap:  newVisitMap,
        orderMap:  newOrderMap,
        allOrders: newAllOrders,
        fetchedAt: new Date().toISOString(),
      }

      applyPayload(payload)
      // Salva direto no localStorage (síncrono) E via serverSave (compatibilidade)
      writeCacheSync(shopId, CACHE_KEY, payload)
      serverSave(CACHE_KEY, payload).catch(() => {})

      toast.success(
        `${itemIds.length} produtos · ${newAllOrders.length} pedidos · 90 dias`,
        { id: 'analytics' },
      )
    } catch (e) {
      toast.error('Erro: ' + (e as Error).message, { id: 'analytics' })
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, mlConnected, products, loaded, shopId])

  // ── Auto-load: só busca da API se cache expirou ou não existe ─────────────
  useEffect(() => {
    if (!mlConnected || !userId || !products.length) return
    if (initDoneRef.current) return
    initDoneRef.current = true

    // Verifica se cache ainda é válido — se sim, não faz nada
    const cached = readCacheSync(shopId, CACHE_KEY)
    if (cached) return  // já carregado no useState inicial

    // Cache expirado ou inexistente → busca da API
    load(false)
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
