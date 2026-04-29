import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import {
  ml, setToken, setShopId, setUserId as setMLUserId, serverSave,
  exchangeCode, refreshToken as refreshMLToken, getAuthUrl,
} from '@/services/ml-api'

export interface Shop {
  id: string           // ex: 'conta-1', 'conta-2'
  name: string         // nome da conta (nickname do ML ou custom)
  mlUserId?: string    // user_id do ML vinculado
  mlNickname?: string  // nickname do ML vinculado
  mlConnected: boolean // tem token ML válido salvo
}

export interface MLUser { id: number; nickname: string; email?: string }

interface Ctx {
  // conta local ativa (login simples)
  user: string | null
  // conta ML da shop ativa
  userId: string
  currentShop: Shop | null
  shops: Shop[]
  mlUser: MLUser | null
  mlConnected: boolean
  // ações
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  switchShop: (shop: Shop) => void
  addShop: (name: string) => Shop
  removeShop: (shopId: string) => void
  connectML: () => void
  handleMLCallback: (code: string) => Promise<void>
  disconnectML: () => void
  // compat
  setCurrentShop: (shop: Shop) => void
}

const AuthContext = createContext<Ctx | null>(null)

const LS = {
  get:  (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set:  (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} },
  del:  (k: string) => { try { localStorage.removeItem(k) } catch {} },
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

function loadSession(): Session | null {
  const raw = LS.get(SESSION_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as Session } catch { return null }
}

function saveSession(s: Session) {
  LS.set(SESSION_KEY, JSON.stringify(s))
}

// chaves de token por shop isoladas
const tokenKey   = (shopId: string) => `ml-token-${shopId}`
const refreshKey = (shopId: string) => `ml-refresh-${shopId}`

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,        setUser]    = useState<string | null>(null)
  const [shops,       setShops]   = useState<Shop[]>([])
  const [currentShop, setShopSt] = useState<Shop | null>(null)
  const [mlUser,      setMlUser]  = useState<MLUser | null>(null)
  const [mlConnected, setConnected] = useState(false)
  const [userId,      setUserId]  = useState('')

  // ── tenta refresh de token de uma shop ────────────────────────────────────
  const tryRefresh = useCallback(async (shopId: string): Promise<string | null> => {
    const rt = LS.get(refreshKey(shopId))
    if (!rt) return null
    try {
      const t = await refreshMLToken(rt)
      LS.set(tokenKey(shopId), t.access_token)
      if (t.refresh_token) LS.set(refreshKey(shopId), t.refresh_token)
      return t.access_token
    } catch { return null }
  }, [])

  // ── ativa os dados de uma shop no estado global ────────────────────────────
  const activateShop = useCallback(async (shop: Shop, allShops: Shop[]) => {
    setShopSt(shop)
    setShopId(shop.id)
    setMlUser(null)
    setUserId('')
    setConnected(false)
    setToken('')

    const tok = LS.get(tokenKey(shop.id))
    if (!tok) return

    // tenta usar token salvo
    const tryToken = async (t: string) => {
      setToken(t)
      const u = await ml('/users/me') as MLUser
      setMlUser(u)
      setUserId(String(u.id))
      setMLUserId(String(u.id))
      setConnected(true)

      // atualiza nickname na shop
      const updated = allShops.map(s =>
        s.id === shop.id
          ? { ...s, mlUserId: String(u.id), mlNickname: u.nickname, mlConnected: true }
          : s
      )
      setShops(updated)
      return updated
    }

    try {
      await tryToken(tok)
    } catch {
      const nt = await tryRefresh(shop.id)
      if (nt) {
        try { await tryToken(nt) } catch { LS.del(tokenKey(shop.id)) }
      } else {
        LS.del(tokenKey(shop.id))
      }
    }
  }, [tryRefresh])

  // ── restaurar sessão no boot ──────────────────────────────────────────────
  useEffect(() => {
    const s = loadSession()
    if (!s) return

    setUser(s.user)
    const savedShops = s.shops || []
    setShops(savedShops)

    const active = savedShops.find(x => x.id === s.currentShopId) || savedShops[0] || null
    if (active) {
      activateShop(active, savedShops)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── persist helper ────────────────────────────────────────────────────────
  const persist = useCallback((u: string, allShops: Shop[], activeId: string | null) => {
    saveSession({ user: u, shops: allShops, currentShopId: activeId })
  }, [])

  // ── login simples ─────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, _pw: string): Promise<{ ok: boolean }> => {
    const s = loadSession()

    // recupera shops existentes ou cria a primeira
    let savedShops: Shop[] = s?.shops || []
    if (!savedShops.length) {
      savedShops = [{ id: 'conta-1', name: 'Conta 1', mlConnected: false }]
    }

    setUser(username)
    setShops(savedShops)
    persist(username, savedShops, savedShops[0]?.id || null)

    const active = savedShops[0]
    if (active) await activateShop(active, savedShops)

    return { ok: true }
  }, [activateShop, persist])

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null); setUserId(''); setMlUser(null); setConnected(false)
    setShopSt(null); setShops([]); setToken(''); setShopId('')
    LS.del(SESSION_KEY)
  }, [])

  // ── trocar de shop ────────────────────────────────────────────────────────
  const switchShop = useCallback((shop: Shop) => {
    setShops(prev => {
      persist(user!, prev, shop.id)
      activateShop(shop, prev)
      return prev
    })
  }, [user, activateShop, persist])

  // compat alias
  const setCurrentShop = switchShop

  // ── adicionar nova conta ──────────────────────────────────────────────────
  const addShop = useCallback((name: string): Shop => {
    const newId = `conta-${Date.now()}`
    const newShop: Shop = { id: newId, name, mlConnected: false }
    setShops(prev => {
      const updated = [...prev, newShop]
      persist(user!, updated, currentShop?.id || null)
      return updated
    })
    return newShop
  }, [user, currentShop, persist])

  // ── remover conta ─────────────────────────────────────────────────────────
  const removeShop = useCallback((shopId: string) => {
    // limpa tokens da conta removida
    LS.del(tokenKey(shopId))
    LS.del(refreshKey(shopId))

    setShops(prev => {
      const updated = prev.filter(s => s.id !== shopId)
      const nextActive = currentShop?.id === shopId
        ? updated[0] || null
        : currentShop

      persist(user!, updated, nextActive?.id || null)

      if (currentShop?.id === shopId && nextActive) {
        activateShop(nextActive, updated)
      }

      return updated
    })
  }, [user, currentShop, activateShop, persist])

  // ── iniciar OAuth ML para a shop ativa ────────────────────────────────────
  const connectML = useCallback(async () => {
    const verifier  = randStr(48)
    const challenge = await sha256b64url(verifier)
    LS.set('pkce-verifier', verifier)
    LS.set('pkce-shop-id', currentShop?.id || 'conta-1')
    const url = await getAuthUrl(challenge)
    window.location.href = url
  }, [currentShop])

  // ── callback OAuth ML ─────────────────────────────────────────────────────
  const handleMLCallback = useCallback(async (code: string) => {
    const verifier = LS.get('pkce-verifier')
    const shopId   = LS.get('pkce-shop-id') || currentShop?.id || 'conta-1'
    if (!verifier) throw new Error('code_verifier não encontrado. Tente novamente.')

    const tokens = await exchangeCode(code, verifier)
    LS.del('pkce-verifier')
    LS.del('pkce-shop-id')

    LS.set(tokenKey(shopId), tokens.access_token)
    if (tokens.refresh_token) LS.set(refreshKey(shopId), tokens.refresh_token)

    setToken(tokens.access_token)
    setShopId(shopId)

    const u = await ml('/users/me') as MLUser
    setMlUser(u)
    setUserId(String(u.id))
    setConnected(true)

    // atualiza a shop com os dados ML
    setShops(prev => {
      const updated = prev.map(s =>
        s.id === shopId
          ? { ...s, mlUserId: String(u.id), mlNickname: u.nickname, mlConnected: true, name: s.name }
          : s
      )
      // se a shop não existia ainda (callback de nova conta), adiciona
      const exists = updated.find(s => s.id === shopId)
      const final  = exists ? updated : [...updated, { id: shopId, name: u.nickname, mlUserId: String(u.id), mlNickname: u.nickname, mlConnected: true }]

      const active = final.find(s => s.id === shopId) || final[0]
      setShopSt(active || null)
      persist(user || u.nickname, final, shopId)
      return final
    })

    await serverSave('ml-user', { id: u.id, nickname: u.nickname })
  }, [currentShop, user, persist])

  // ── desconectar ML da shop ativa ──────────────────────────────────────────
  const disconnectML = useCallback(() => {
    const id = currentShop?.id
    if (id) {
      LS.del(tokenKey(id))
      LS.del(refreshKey(id))
    }
    setToken('')
    setMlUser(null)
    setUserId('')
    setConnected(false)

    setShops(prev => {
      const updated = prev.map(s =>
        s.id === id ? { ...s, mlConnected: false, mlUserId: undefined, mlNickname: undefined } : s
      )
      persist(user!, updated, id || null)
      return updated
    })
  }, [currentShop, user, persist])

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
