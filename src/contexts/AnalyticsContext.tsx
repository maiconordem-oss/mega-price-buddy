/**
 * AnalyticsContext — busca centralizada de visitas + pedidos (90 dias)
 *
 * Busca UMA VEZ e compartilha com todas as abas:
 * - VisitasTab    → filtra visitMap + orderMap pelo período escolhido
 * - CurvaAbcTab   → mesmo dado, classificação ABC local
 * - HistoricoTab  → usa allOrders (paid) + busca própria para outros status
 * - AnaliseTab    → usa orderMap para margens (reputação busca separado, é leve)
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
  mlItemId: string   // "MLB123..."
  quantity: number
  unitPrice: number
  title: string
}

export interface Order {
  id: number
  dateCreated: string   // ISO
  buyerNickname: string
  total: number
  status: string
  items: OrderItem[]
}

export interface VisitData {
  [mlItemId: string]: number   // total de visitas nos 90 dias
}

export interface OrderData {
  [mlItemId: string]: { qty: number; revenue: number }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface Ctx {
  // dados brutos
  visitMap:  VisitData        // visitas por item (90 dias)
  orderMap:  OrderData        // vendas por item (90 dias, status=paid)
  allOrders: Order[]          // todos os pedidos (90 dias, status=paid)

  // estado
  loading:   boolean
  loaded:    boolean
  lastFetch: Date | null
  fetchedAt: string | null    // ISO — para abas calcularem "age"

  // ação
  load: (force?: boolean) => Promise<void>
}

const AnalyticsContext = createContext<Ctx | null>(null)

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'analytics-90d'
const CACHE_TTL = 120  // minutos

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
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const loadingRef = useRef(false)

  // Reset ao trocar de conta
  useShopReset(useCallback(() => {
    setVisitMap({}); setOrderMap({}); setAllOrders([])
    setLoaded(false); setLastFetch(null); setFetchedAt(null)
  }, []))

  // ── apply payload ────────────────────────────────────────────────────────
  function applyPayload(p: CachePayload) {
    setVisitMap(p.visitMap)
    setOrderMap(p.orderMap)
    setAllOrders(p.allOrders)
    setFetchedAt(p.fetchedAt)
    setLastFetch(new Date(p.fetchedAt))
    setLoaded(true)
  }

  // ── load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (!mlConnected || !userId) {
      toast.info('Conecte o Mercado Livre para carregar os dados.')
      return
    }
    if (loadingRef.current) return
    if (!force && loaded) return  // já carregado em memória

    // tentar cache localStorage (2h)
    if (!force) {
      try {
        const cached = await serverLoad<CachePayload>(CACHE_KEY)
        if (cached?.data && cached?.ts) {
          const age = (Date.now() - new Date(cached.ts).getTime()) / 60000
          if (age < CACHE_TTL) {
            applyPayload(cached.data)
            return
          }
        }
      } catch {}
    }

    loadingRef.current = true
    setLoading(true)

    try {
      const now      = new Date()
      const from90   = new Date(now.getTime() - 90 * 86400000)
      const dateFrom = toMLDate(from90)
      const dateTo   = toMLDate(now)

      const mlItems = products.filter(p => p.mlItemId)
      if (!mlItems.length) {
        toast.info('Carregue os produtos do ML primeiro.')
        return
      }
      const itemIds = mlItems.map(p => p.mlItemId!)

      // ── 1. Visitas: 1 item por request, paralelo em lotes de 8 ───────────
      toast.loading('Buscando visitas...', { id: 'analytics' })
      const newVisitMap: VisitData = {}

      for (const batch of chunks(itemIds, 8)) {
        await Promise.all(batch.map(async id => {
          try {
            const res = await ml(
              `/visits/items?ids=${id}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
            ) as Record<string, { total_visits: number }>
            newVisitMap[id] = res[id]?.total_visits || 0
          } catch {
            newVisitMap[id] = 0
          }
        }))
        await new Promise(r => setTimeout(r, 150))
      }

      // ── 2. Pedidos (90 dias, status=paid) ────────────────────────────────
      toast.loading('Buscando pedidos...', { id: 'analytics' })

      type RawOI    = { item: { id: string; title?: string }; quantity: number; unit_price: number }
      type RawOrder = {
        id: number
        date_created: string
        buyer: { nickname: string }
        total_amount: number
        status: string
        order_items: RawOI[]
      }

      const raw = await fetchAllOrders(userId, 'paid', dateFrom, 40) as RawOrder[]

      const newOrderMap: OrderData = {}
      const newAllOrders: Order[] = raw.map(o => {
        const items: OrderItem[] = (o.order_items || []).map(oi => {
          const rawId = oi.item?.id
          const id    = rawId ? (String(rawId).startsWith('MLB') ? String(rawId) : `MLB${rawId}`) : ''
          if (id) {
            newOrderMap[id] = newOrderMap[id] || { qty: 0, revenue: 0 }
            newOrderMap[id].qty     += Number(oi.quantity) || 0
            newOrderMap[id].revenue += (Number(oi.quantity) || 0) * (Number(oi.unit_price) || 0)
          }
          return {
            mlItemId:  id,
            quantity:  Number(oi.quantity) || 0,
            unitPrice: Number(oi.unit_price) || 0,
            title:     oi.item?.title || '',
          }
        })
        return {
          id:              o.id,
          dateCreated:     o.date_created,
          buyerNickname:   o.buyer?.nickname || '',
          total:           Number(o.total_amount) || 0,
          status:          o.status,
          items,
        }
      })

      const fetchedAt = new Date().toISOString()
      const payload: CachePayload = {
        visitMap:  newVisitMap,
        orderMap:  newOrderMap,
        allOrders: newAllOrders,
        fetchedAt,
      }

      applyPayload(payload)
      serverSave(CACHE_KEY, payload).catch(() => {})

      toast.success(
        `${itemIds.length} produtos · ${newAllOrders.length} pedidos · 90 dias`,
        { id: 'analytics' },
      )
    } catch (e) {
      toast.error('Erro ao carregar analytics: ' + (e as Error).message, { id: 'analytics' })
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [userId, mlConnected, products, loaded])

  // Auto-carrega quando conectar ML e tiver produtos
  useEffect(() => {
    if (mlConnected && userId && products.length && !loaded && !loadingRef.current) {
      load(false)
    }
  }, [mlConnected, userId, products.length]) // eslint-disable-line

  return (
    <AnalyticsContext.Provider value={{
      visitMap, orderMap, allOrders,
      loading, loaded, lastFetch, fetchedAt,
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

// ── Helpers públicos para as abas ─────────────────────────────────────────────

/** Filtra allOrders pelo período (dias a partir de agora) */
export function filterOrdersByDays(orders: Order[], days: number): Order[] {
  const cutoff = Date.now() - days * 86400000
  return orders.filter(o => new Date(o.dateCreated).getTime() >= cutoff)
}

/** Agrega orderMap a partir de lista filtrada de pedidos */
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
