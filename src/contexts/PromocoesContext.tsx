/**
 * PromocoesContext — compartilha dados de promoções ML entre abas.
 * PromocoesTab escreve aqui; PrecificacaoTab lê os preços ativos.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { useShopReset } from '@/hooks/useShopReset'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface ActivePromo {
  mlItemId:      string
  promotionType: string
  name:          string
  finalPrice:    number   // preço final com desconto
  discountPct:   number   // decimal (ex: 0.05 = 5%)
  sellerPct?:    number
  meliPct?:      number
  startDate?:    string
  endDate?:      string
}

interface Ctx {
  // Map de mlItemId → promoção ativa
  activePromos: Record<string, ActivePromo>
  setActivePromos: (promos: ActivePromo[]) => void
  clearPromos: () => void
}

const PromocoesContext = createContext<Ctx | null>(null)

export function PromocoesProvider({ children }: { children: ReactNode }) {
  const [activePromos, setActivePromosState] = useState<Record<string, ActivePromo>>({})

  useShopReset(useCallback(() => {
    setActivePromosState({})
  }, []))

  const setActivePromos = useCallback((promos: ActivePromo[]) => {
    const map: Record<string, ActivePromo> = {}
    for (const p of promos) { map[p.mlItemId] = p }
    setActivePromosState(map)
  }, [])

  const clearPromos = useCallback(() => setActivePromosState({}), [])

  return (
    <PromocoesContext.Provider value={{ activePromos, setActivePromos, clearPromos }}>
      {children}
    </PromocoesContext.Provider>
  )
}

export function usePromocoes() {
  const ctx = useContext(PromocoesContext)
  if (!ctx) throw new Error('usePromocoes must be used within PromocoesProvider')
  return ctx
}
