/**
 * AnalyticsContext — busca centralizada de visitas + pedidos (90 dias)
 * Cache persistente: 6h no localStorage. Nunca rebusca sem necessidade.
 */

import {
  createContext, useContext, useState, useCallback,
  useRef, useEffect, type ReactNode,
} from 'react'
import { ml, serverSave, serverLoad, toMLDate, chunks, fetchAllOrders } from '@/services/ml-api'
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
const CACHE_KEY = 'analytics-90d'
const CACHE_TTL = 360  // 6 horas em minutos

interface CachePayload {
  visitMap:  VisitData
  orderMap:  OrderData
  allOrders: Order[]
  fetchedAt: string
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { userId, mlConnected } = useAuth()
  const { products } = useProducts()

  const [visitMap,  setVisitMap]  = useState<VisitData>({})
  const [orderMap,  setOrderMap]  = useState<OrderData>({})
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [loading,   setLoading]   = useState(false)
  const [loaded,    setLoaded]    = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const loadingRef  = useRef(false)
  const initDoneRef = useRef(false)  // garante que auto-load roda só uma vez por sessão

  useShopReset(useCallback(() => {
    setVisitMap({}); setOrderMap({}); setAllOrders([])
    setLoaded(false); setLastFetch(null)
    initDoneRef.current = false
  }, []))

  function applyPayload(p: CachePayload) {
    setVisitMap(p.visitMap)
    setOrderMap(p.orderMap)
    setAllOrders(p.allOrders)
    setLastFetch(new Date(p.fetchedAt))
    setLoaded(true)
  }

  // ── Verifica cache sem fazer fetch ────────────────────────────────────────
  async function tryCache(): Promise<boolean> {
    try {
      const cached = await serverLoad<CachePayload>(CACHE_KEY)
      if (!cached?.data || !cached?.ts) return false
      const ageMin = (Date.now() - new Date(cached.ts).getTime()) / 60000
      if (ageMin >= CACHE_TTL) return false
      applyPayload(cached.data)
      return true
    } catch {
      return false
    }
  }

  // ── Fetch completo da API ─────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) {
      toast.info('Conecte o Mercado Livre para carregar os dados.')
      return
    }
    if (loadingRef.current) return

    // Sem force: tenta memória, depois cache, depois busca
    if (!force) {
      if (loaded) return                    // já em memória, não faz nada
      const hit = await tryCache()
      if (hit) return                       // cache válido, carregou do localStorage
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
      // A API /visits/items retorna ARRAY: [{ item_id: "MLB...", total_visits: N }, ...]
      // Aceita apenas 1 id por request
      toast.loading(`Buscando visitas (${itemIds.length} produtos)...`, { id: 'analytics' })
      const newVisitMap: VisitData = {}

      for (const batch of chunks(itemIds, 8)) {
        await Promise.all(batch.map(async id => {
          try {
            const res = await ml(
              `/visits/items?ids=${id}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
            )
            // Resposta pode ser array OU objeto dependendo da versão da API
            if (Array.isArray(res)) {
              // formato array: [{ item_id: "MLB123", total_visits: 42 }]
              const found = (res as Array<{ item_id: string; total_visits: number }>)
                .find(r => r.item_id === id)
              newVisitMap[id] = found?.total_visits || 0
            } else {
              // formato objeto: { "MLB123": { total_visits: 42 } }
              const obj = res as Record<string, { total_visits?: number } | number>
              const val = obj[id]
              newVisitMap[id] = typeof val === 'number'
                ? val
                : (val as { total_visits?: number })?.total_visits || 0
            }
          } catch {
            newVisitMap[id] = 0
          }
        }))
        await new Promise(r => setTimeout(r, 200))
      }

      // ── 2. Pedidos ────────────────────────────────────────────────────────
      toast.loading('Buscando pedidos (90 dias)...', { id: 'analytics' })

      type RawOI = {
        item:       { id: string | number; title?: string }
        quantity:   number
        unit_price: number
      }
      type RawOrder = {
        id:           number
        date_created: string
        buyer:        { nickname: string }
        total_amount: number
        status:       string
        order_items:  RawOI[]
      }

      const raw = await fetchAllOrders(userId, 'paid', dateFrom, 40) as RawOrder[]

      const newOrderMap: OrderData  = {}
      const newAllOrders: Order[]   = raw.map(o => {
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
          return {
            mlItemId:  id,
            quantity:  Number(oi.quantity)   || 0,
            unitPrice: Number(oi.unit_price) || 0,
            title:     oi.item?.title || '',
          }
        })
        return {
          id:            o.id,
          dateCreated:   o.date_created,
          buyerNickname: o.buyer?.nickname || '',
          total:         Number(o.total_amount) || 0,
          status:        o.status,
          items,
        }
      })

      const payload: CachePayload = {
        visitMap:  newVisitMap,
        orderMap:  newOrderMap,
        allOrders: newAllOrders,
        fetchedAt: new Date().toISOString(),
      }

      applyPayload(payload)
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
  }, [userId, mlConnected, products])

  // ── Auto-load: roda uma vez por sessão quando ML conecta + tem produtos ──
  useEffect(() => {
    if (!mlConnected || !userId || !products.length) return
    if (initDoneRef.current) return
    initDoneRef.current = true
    load(false)   // vai para cache se ainda válido, senão busca
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlConnected, userId, products.length])

  return (
    <AnalyticsContext.Provider value={{
      visitMap, orderMap, allOrders,
      loading, loaded, lastFetch,
      load,
    }}>
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
