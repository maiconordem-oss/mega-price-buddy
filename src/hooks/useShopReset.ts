import { useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Executa `onReset` sempre que o shopId (conta ativa) mudar.
 * Use para limpar dados de cache em memória ao trocar de conta.
 */
export function useShopReset(onReset: () => void) {
  const { currentShop } = useAuth()
  const shopId = currentShop?.id ?? 'default'
  const prevRef = useRef(shopId)

  useEffect(() => {
    if (prevRef.current === shopId) return
    prevRef.current = shopId
    onReset()
  }, [shopId, onReset])

  return shopId
}
