import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  ml, setToken, setShopId, serverSave,
  exchangeCode, refreshToken as refreshMLToken, getAuthUrl,
} from '@/services/ml-api'

export interface Shop   { id: string; name: string }
export interface MLUser { id: number; nickname: string; email?: string }

interface Ctx {
  user: string | null
  userId: string
  currentShop: Shop | null
  shops: Shop[]
  mlUser: MLUser | null
  mlConnected: boolean
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  setCurrentShop: (shop: Shop) => void
  connectML: () => void
  handleMLCallback: (code: string) => Promise<void>
  disconnectML: () => void
}

const AuthContext = createContext<Ctx | null>(null)

const LS = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k) } catch {} },
}

// PKCE helpers
function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function randStr(len: number) {
  const a = new Uint8Array(len); crypto.getRandomValues(a); return b64url(a.buffer)
}
async function sha256b64url(str: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return b64url(h)
}

const SESSION_KEY = 'megalabs_v2_session'
interface Session { user: string; userId: string; shops: Shop[]; currentShop: Shop | null; mlConnected: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]      = useState<string | null>(null)
  const [userId,      setUserId]    = useState('')
  const [mlUser,      setMlUser]    = useState<MLUser | null>(null)
  const [shops,       setShops]     = useState<Shop[]>([])
  const [currentShop, setShopSt]   = useState<Shop | null>(null)
  const [mlConnected, setConnected] = useState(false)

  const persist = useCallback((s: Session) => LS.set(SESSION_KEY, JSON.stringify(s)), [])

  const tryRefresh = useCallback(async (shopId: string): Promise<string | null> => {
    const rt = LS.get(`ml-refresh-${shopId}`)
    if (!rt) return null
    try {
      const t = await refreshMLToken(rt)
      LS.set(`ml-token-${shopId}`, t.access_token)
      if (t.refresh_token) LS.set(`ml-refresh-${shopId}`, t.refresh_token)
      return t.access_token
    } catch { return null }
  }, [])

  useEffect(() => {
    const raw = LS.get(SESSION_KEY)
    if (!raw) return
    try {
      const s: Session = JSON.parse(raw)
      setUser(s.user); setUserId(s.userId || ''); setShops(s.shops || [])
      setShopSt(s.currentShop || null)
      if (s.currentShop?.id) {
        const id = s.currentShop.id
        setShopId(id)
        const tok = LS.get(`ml-token-${id}`)
        if (tok) {
          setToken(tok)
          ml('/users/me')
            .then(u => { const mu = u as MLUser; setMlUser(mu); setUserId(String(mu.id)); setConnected(true) })
            .catch(async () => {
              const nt = await tryRefresh(id)
              if (nt) {
                setToken(nt)
                const u = await ml('/users/me') as MLUser
                setMlUser(u); setUserId(String(u.id)); setConnected(true)
              } else { LS.del(`ml-token-${id}`); setConnected(false) }
            })
        }
      }
    } catch {}
  }, [tryRefresh])

  const login = useCallback(async (username: string, _pw: string): Promise<{ ok: boolean }> => {
    const shop: Shop = { id: '1', name: username }
    setUser(username); setShops([shop]); setShopSt(shop); setShopId(shop.id)
    const tok = LS.get(`ml-token-${shop.id}`)
    if (tok) {
      try {
        setToken(tok)
        const u = await ml('/users/me') as MLUser
        setMlUser(u); setUserId(String(u.id)); setConnected(true)
        persist({ user: username, userId: String(u.id), shops: [shop], currentShop: shop, mlConnected: true })
        return { ok: true }
      } catch {
        const nt = await tryRefresh(shop.id)
        if (nt) {
          setToken(nt)
          const u = await ml('/users/me') as MLUser
          setMlUser(u); setUserId(String(u.id)); setConnected(true)
          persist({ user: username, userId: String(u.id), shops: [shop], currentShop: shop, mlConnected: true })
          return { ok: true }
        }
        LS.del(`ml-token-${shop.id}`)
      }
    }
    persist({ user: username, userId: '', shops: [shop], currentShop: shop, mlConnected: false })
    return { ok: true }
  }, [persist, tryRefresh])

  const logout = useCallback(() => {
    setUser(null); setUserId(''); setMlUser(null); setConnected(false)
    setShopSt(null); setShops([]); setToken(''); setShopId('')
    LS.del(SESSION_KEY)
  }, [])

  const setCurrentShop = useCallback((shop: Shop) => {
    setShopSt(shop); setShopId(shop.id)
    const tok = LS.get(`ml-token-${shop.id}`)
    if (tok) {
      setToken(tok)
      ml('/users/me')
        .then(u => { const mu = u as MLUser; setMlUser(mu); setUserId(String(mu.id)); setConnected(true) })
        .catch(() => { setToken(''); setConnected(false); setMlUser(null); setUserId('') })
    } else { setToken(''); setConnected(false); setMlUser(null); setUserId('') }
    persist({ user: user!, userId, shops, currentShop: shop, mlConnected: !!tok })
  }, [user, userId, shops, persist])

  const connectML = useCallback(async () => {
    const verifier  = randStr(48)
    const challenge = await sha256b64url(verifier)
    LS.set('pkce-verifier', verifier)
    LS.set('pkce-shop-id', currentShop?.id || '1')
    const url = await getAuthUrl(challenge)
    window.location.href = url
  }, [currentShop])

  const handleMLCallback = useCallback(async (code: string) => {
    const verifier = LS.get('pkce-verifier')
    const shopId   = LS.get('pkce-shop-id') || currentShop?.id || '1'
    if (!verifier) throw new Error('code_verifier não encontrado. Tente novamente.')

    const tokens = await exchangeCode(code, verifier)
    LS.del('pkce-verifier'); LS.del('pkce-shop-id')

    LS.set(`ml-token-${shopId}`, tokens.access_token)
    if (tokens.refresh_token) LS.set(`ml-refresh-${shopId}`, tokens.refresh_token)

    setToken(tokens.access_token); setShopId(shopId)
    const u = await ml('/users/me') as MLUser
    setMlUser(u); setUserId(String(u.id)); setConnected(true)

    const shop = currentShop || { id: shopId, name: u.nickname }
    const su   = user || u.nickname
    const ss   = shops.length ? shops : [shop]

    setUser(su); setShopSt(shop); setShops(ss)
    persist({ user: su, userId: String(u.id), shops: ss, currentShop: shop, mlConnected: true })
    await serverSave('ml-user', { id: u.id, nickname: u.nickname })
  }, [currentShop, user, shops, persist])

  const disconnectML = useCallback(() => {
    const id = currentShop?.id
    if (id) { LS.del(`ml-token-${id}`); LS.del(`ml-refresh-${id}`) }
    setToken(''); setMlUser(null); setUserId(''); setConnected(false)
    persist({ user: user!, userId: '', shops, currentShop, mlConnected: false })
  }, [currentShop, user, shops, persist])

  return (
    <AuthContext.Provider value={{
      user, userId, currentShop, shops, mlUser, mlConnected,
      login, logout, setCurrentShop, connectML, handleMLCallback, disconnectML,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
