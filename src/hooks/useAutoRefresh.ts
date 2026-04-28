import { useEffect, useRef, useCallback } from 'react'

/**
 * Executa `fn` imediatamente e depois a cada `intervalMs` ms.
 * Para quando o componente desmonta ou quando `enabled` é false.
 */
export function useAutoRefresh(
  fn: () => Promise<void> | void,
  intervalMs: number,
  enabled: boolean,
) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(() => { fnRef.current() }, [])

  useEffect(() => {
    if (!enabled) return
    run()
    const id = setInterval(run, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs, run])
}
