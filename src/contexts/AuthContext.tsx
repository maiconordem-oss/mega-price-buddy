import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import {
  ml, setToken, setShopId, setUserId as setMLUserId, setLoginUser,
  exchangeCode, refreshToken as refreshMLToken, getAuthUrl,
  sessionSave, sessionLoad,
} from '@/services/ml-api'

export interface Shop {
  id: string
  name: string
  mlUserId?: string
  mlNickname?: string
  mlConnected: boolean
  // Tokens embutidos para persistir no servidor (KV)
  mlAccessToken?: string
  mlRefreshToken?: string
}

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
  switchShop: (shop: Shop) => void
  addShop: (name: string) => Shop
  removeShop: (shopId: string) => void
  connectML: () => void
  handleMLCallback: (code: string) => Promise<void>
  disconnectML: () => void
  setCurrentShop: (shop: Shop) => void
}

const AuthContext = createContext<Ctx | null>(null)

const LS = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k) } catch {} },
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────
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

// ── Persistência ──────────────────────────────────────────────────────────────
const SESSION_KEY = 'megalabs_v3_session'

interface Session {
  user: string
  shops: Shop[]
  currentShopId: string | null
}

function loadLocalSession(): Session | null {
  const raw = LS.get(SESSION_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as Session } catch { return null }
}
function saveLocalSession(s: Session) { LS.set(SESSION_KEY, JSON.stringify(s)) }

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]      = useState<string | null>(null)
  const [shops,       setShops]     = useState<Shop[]>([])
  const [currentShop, setShopSt]    = useState<Shop | null>(null)
  const [mlUser,      setMlUser]    = useState<MLUser | null>(null)
  const [mlConnected, setConnected] = useState(false)
  const [userId,      setUserId]    = useState('')

  // ref para evitar loops de save no boot
  const bootedRef = useRef(false)

  // ── persiste sessão (local + servidor) ────────────────────────────────────
  const persist = useCallback(async (u: string, allShops: Shop[], activeId: string | null) => {
    const session: Session = { user: u, shops: allShops, currentShopId: activeId }
    saveLocalSession(session)
    try { await sessionSave(u, session) } catch {}
  }, [])

  // ── refresh de token ──────────────────────────────────────────────────────
  const tryRefresh = useCallback(async (shop: Shop): Promise<string | null> => {
    if (!shop.mlRefreshToken) return null
    try {
      const t = await refreshMLToken(shop.mlRefreshToken)
      return t.access_token
    } catch { return null }
  }, [])

  // ── ativa shop: aplica token, busca /users/me ─────────────────────────────
  const activateShop = useCallback(async (shop: Shop, allShops: Shop[], currentUser: string) => {
    setShopSt(shop)
    setShopId(shop.id)
    setMlUser(null); setUserId(''); setMLUserId(''); setConnected(false); setToken('')

    if (!shop.mlAccessToken) return

    const tryToken = async (t: string, refresh?: string) => {
      setToken(t)
      const u = await ml('/users/me') as MLUser
      setMlUser(u); setUserId(String(u.id)); setMLUserId(String(u.id)); setConnected(true)

      const updated = allShops.map(s =>
        s.id === shop.id
          ? { ...s, mlUserId: String(u.id), mlNickname: u.nickname, mlConnected: true,
              mlAccessToken: t, mlRefreshToken: refresh ?? s.mlRefreshToken }
          : s,
      )
      setShops(updated)
      persist(currentUser, updated, shop.id)
    }

    try {
      await tryToken(shop.mlAccessToken)
    } catch {
      const nt = await tryRefresh(shop)
      if (nt) {
        try { await tryToken(nt) } catch {
          // refresh falhou também — marca desconectado
          const updated = allShops.map(s =>
            s.id === shop.id ? { ...s, mlConnected: false, mlAccessToken: undefined } : s,
          )
          setShops(updated); persist(currentUser, updated, shop.id)
        }
      }
    }
  }, [tryRefresh, persist])

  // ── restaurar sessão local no boot ────────────────────────────────────────
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    const s = loadLocalSession()
    if (!s) return
    setUser(s.user)
    setLoginUser(s.user)
    const savedShops = s.shops || []
    setShops(savedShops)
    const active = savedShops.find(x => x.id === s.currentShopId) || savedShops[0] || null
    if (active) activateShop(active, savedShops, s.user)
  }, [activateShop])

  // ── login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, _pw: string): Promise<{ ok: boolean }> => {
    setLoginUser(username)

    // 1) Tenta carregar sessão completa do servidor (KV)
    let serverSession: Session | null = null
    try {
      serverSession = await sessionLoad<Session>(username)
    } catch {}

    // 2) Senão, fallback local
    const local = loadLocalSession()
    const base = serverSession || local

    let savedShops: Shop[] = base?.shops || []
    if (!savedShops.length) {
      savedShops = [{ id: 'conta-1', name: 'Conta 1', mlConnected: false }]
    }

    setUser(username)
    setShops(savedShops)
    await persist(username, savedShops, base?.currentShopId || savedShops[0]?.id || null)

    const activeId = base?.currentShopId || savedShops[0]?.id
    const active = savedShops.find(s => s.id === activeId) || savedShops[0]
    if (active) await activateShop(active, savedShops, username)

    return { ok: true }
  }, [activateShop, persist])

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null); setUserId(''); setMlUser(null); setConnected(false)
    setShopSt(null); setShops([])
    setToken(''); setShopId(''); setMLUserId(''); setLoginUser('')
    LS.del(SESSION_KEY)
  }, [])

  // ── trocar de shop ────────────────────────────────────────────────────────
  const switchShop = useCallback((shop: Shop) => {
    if (!user) return
    persist(user, shops, shop.id)
    activateShop(shop, shops, user)
  }, [user, shops, activateShop, persist])

  const setCurrentShop = switchShop

  // ── adicionar conta ───────────────────────────────────────────────────────
  const addShop = useCallback((name: string): Shop => {
    const newShop: Shop = { id: `conta-${Date.now()}`, name, mlConnected: false }
    const updated = [...shops, newShop]
    setShops(updated)
    if (user) persist(user, updated, currentShop?.id || null)
    return newShop
  }, [shops, user, currentShop, persist])

  // ── remover conta ─────────────────────────────────────────────────────────
  const removeShop = useCallback((shopId: string) => {
    const updated = shops.filter(s => s.id !== shopId)
    const nextActive = currentShop?.id === shopId ? updated[0] || null : currentShop
    setShops(updated)
    if (user) persist(user, updated, nextActive?.id || null)
    if (currentShop?.id === shopId && nextActive && user) {
      activateShop(nextActive, updated, user)
    }
  }, [shops, user, currentShop, activateShop, persist])

  // ── iniciar OAuth ML ──────────────────────────────────────────────────────
  const connectML = useCallback(async () => {
    const verifier  = randStr(48)
    const challenge = await sha256b64url(verifier)
    LS.set('pkce-verifier', verifier)
    LS.set('pkce-shop-id', currentShop?.id || 'conta-1')
    LS.set('pkce-login-user', user || '')
    const url = await getAuthUrl(challenge)
    window.location.href = url
  }, [currentShop, user])

  // ── callback OAuth ────────────────────────────────────────────────────────
  const handleMLCallback = useCallback(async (code: string) => {
    const verifier = LS.get('pkce-verifier')
    const shopId   = LS.get('pkce-shop-id') || currentShop?.id || 'conta-1'
    const loginU   = LS.get('pkce-login-user') || user || ''
    if (!verifier) throw new Error('code_verifier não encontrado. Tente novamente.')
    if (loginU) setLoginUser(loginU)

    const tokens = await exchangeCode(code, verifier)
    LS.del('pkce-verifier'); LS.del('pkce-shop-id'); LS.del('pkce-login-user')

    setToken(tokens.access_token)
    setShopId(shopId)

    const u = await ml('/users/me') as MLUser
    setMlUser(u); setUserId(String(u.id)); setMLUserId(String(u.id)); setConnected(true)

    const baseShops = shops.length ? shops : (loadLocalSession()?.shops || [])
    const exists = baseShops.find(s => s.id === shopId)
    const updatedShop: Shop = {
      id: shopId,
      name: exists?.name || u.nickname,
      mlUserId: String(u.id),
      mlNickname: u.nickname,
      mlConnected: true,
      mlAccessToken: tokens.access_token,
      mlRefreshToken: tokens.refresh_token || undefined,
    }
    const finalShops = exists
      ? baseShops.map(s => s.id === shopId ? { ...s, ...updatedShop } : s)
      : [...baseShops, updatedShop]

    setShops(finalShops)
    setShopSt(finalShops.find(s => s.id === shopId) || null)
    if (!user && loginU) setUser(loginU)
    await persist(loginU || user || u.nickname, finalShops, shopId)
  }, [shops, currentShop, user, persist])

  // ── desconectar ML ────────────────────────────────────────────────────────
  const disconnectML = useCallback(() => {
    const id = currentShop?.id
    if (!id) return
    setToken(''); setMLUserId(''); setMlUser(null); setUserId(''); setConnected(false)
    const updated = shops.map(s =>
      s.id === id
        ? { ...s, mlConnected: false, mlUserId: undefined, mlNickname: undefined,
            mlAccessToken: undefined, mlRefreshToken: undefined }
        : s,
    )
    setShops(updated)
    if (user) persist(user, updated, id)
  }, [shops, currentShop, user, persist])

  return (
    <AuthContext.Provider value={{
      user, userId, currentShop, shops, mlUser, mlConnected,
      login, logout, switchShop, setCurrentShop, addShop, removeShop,
      connectML, handleMLCallback, disconnectML,
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
