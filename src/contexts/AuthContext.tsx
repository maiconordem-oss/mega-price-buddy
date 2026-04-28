import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  ml, setToken, setShopId, serverSave,
  exchangeCode, refreshToken as refreshMLToken,
  getClientId, getRedirectUri, getAuthBase,
} from "@/services/ml-api";

export interface Shop   { id: string; name: string; }
export interface MLUser { id: number; nickname: string; email?: string; }

interface Ctx {
  user: string | null;
  userId: string;
  currentShop: Shop | null;
  shops: Shop[];
  mlUser: MLUser | null;
  mlConnected: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  setCurrentShop: (shop: Shop) => void;
  connectML: () => void;
  handleMLCallback: (code: string) => Promise<void>;
  disconnectML: () => void;
}

const AuthContext = createContext<Ctx | null>(null);

// ── LocalStorage helpers ───────────────────────────────────────────────────
const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k); } catch {} },
};

// ── PKCE helpers (browser) ─────────────────────────────────────────────────
function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function randStr(len: number) {
  const a = new Uint8Array(len); crypto.getRandomValues(a); return b64url(a.buffer);
}
async function sha256b64url(str: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return b64url(h);
}

const SESSION_KEY = "megalabs_v2_session";
interface Session {
  user: string; userId: string; shops: Shop[]; currentShop: Shop | null; mlConnected: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,          setUser]          = useState<string | null>(null);
  const [userId,        setUserId]        = useState("");
  const [mlUser,        setMlUser]        = useState<MLUser | null>(null);
  const [shops,         setShops]         = useState<Shop[]>([]);
  const [currentShop,   setCurrentShopSt] = useState<Shop | null>(null);
  const [mlConnected,   setMlConnected]   = useState(false);

  const persist = useCallback((s: Session) => LS.set(SESSION_KEY, JSON.stringify(s)), []);

  // ── Tenta renovar token ML ───────────────────────────────────────────────
  const tryRefresh = useCallback(async (shopId: string): Promise<string | null> => {
    const rt = LS.get(`ml-refresh-${shopId}`);
    if (!rt) return null;
    try {
      const tokens = await refreshMLToken(rt);
      LS.set(`ml-token-${shopId}`, tokens.access_token);
      if (tokens.refresh_token) LS.set(`ml-refresh-${shopId}`, tokens.refresh_token);
      return tokens.access_token;
    } catch { return null; }
  }, []);

  // ── Restaura sessão ──────────────────────────────────────────────────────
  useEffect(() => {
    const raw = LS.get(SESSION_KEY);
    if (!raw) return;
    try {
      const s: Session = JSON.parse(raw);
      setUser(s.user);
      setUserId(s.userId || "");
      setShops(s.shops || []);
      setCurrentShopSt(s.currentShop || null);
      if (s.currentShop?.id) {
        const shopId = s.currentShop.id;
        setShopId(shopId);
        const saved = LS.get(`ml-token-${shopId}`);
        if (saved) {
          setToken(saved);
          ml("/users/me")
            .then(u => { const mu = u as MLUser; setMlUser(mu); setUserId(String(mu.id)); setMlConnected(true); })
            .catch(async () => {
              const newTok = await tryRefresh(shopId);
              if (newTok) {
                setToken(newTok);
                const u = await ml("/users/me") as MLUser;
                setMlUser(u); setUserId(String(u.id)); setMlConnected(true);
              } else {
                LS.del(`ml-token-${shopId}`); setMlConnected(false);
              }
            });
        }
      }
    } catch {}
  }, [tryRefresh]);

  // ── Login ────────────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, _pw: string): Promise<{ ok: boolean; error?: string }> => {
    const shop: Shop = { id: "1", name: username };
    setUser(username); setShops([shop]); setCurrentShopSt(shop); setShopId(shop.id);

    const saved = LS.get(`ml-token-${shop.id}`);
    if (saved) {
      try {
        setToken(saved);
        const u = await ml("/users/me") as MLUser;
        setMlUser(u); setUserId(String(u.id)); setMlConnected(true);
        persist({ user: username, userId: String(u.id), shops: [shop], currentShop: shop, mlConnected: true });
        return { ok: true };
      } catch {
        const newTok = await tryRefresh(shop.id);
        if (newTok) {
          setToken(newTok);
          const u = await ml("/users/me") as MLUser;
          setMlUser(u); setUserId(String(u.id)); setMlConnected(true);
          persist({ user: username, userId: String(u.id), shops: [shop], currentShop: shop, mlConnected: true });
          return { ok: true };
        }
        LS.del(`ml-token-${shop.id}`);
      }
    }
    persist({ user: username, userId: "", shops: [shop], currentShop: shop, mlConnected: false });
    return { ok: true };
  }, [persist, tryRefresh]);

  // ── Logout ───────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null); setUserId(""); setMlUser(null);
    setMlConnected(false); setCurrentShopSt(null); setShops([]);
    setToken(""); setShopId("");
    LS.del(SESSION_KEY);
  }, []);

  // ── Troca de loja ────────────────────────────────────────────────────────
  const setCurrentShop = useCallback((shop: Shop) => {
    setCurrentShopSt(shop); setShopId(shop.id);
    const saved = LS.get(`ml-token-${shop.id}`);
    if (saved) {
      setToken(saved);
      ml("/users/me")
        .then(u => { const mu = u as MLUser; setMlUser(mu); setUserId(String(mu.id)); setMlConnected(true); })
        .catch(() => { setToken(""); setMlConnected(false); setMlUser(null); setUserId(""); });
    } else {
      setToken(""); setMlConnected(false); setMlUser(null); setUserId("");
    }
    persist({ user: user!, userId, shops, currentShop: shop, mlConnected: !!saved });
  }, [user, userId, shops, persist]);

  // ── Inicia OAuth ML com PKCE ─────────────────────────────────────────────
  const connectML = useCallback(async () => {
    const verifier  = randStr(48);
    const challenge = await sha256b64url(verifier);
    LS.set("pkce-verifier", verifier);
    LS.set("pkce-shop-id", currentShop?.id || "1");

    const params = new URLSearchParams({
      response_type:         "code",
      client_id:             getClientId(),
      redirect_uri:          getRedirectUri(),
      code_challenge:        challenge,
      code_challenge_method: "S256",
    });
    window.location.href = `${getAuthBase()}/authorization?${params.toString()}`;
  }, [currentShop]);

  // ── Callback: troca code → token ─────────────────────────────────────────
  const handleMLCallback = useCallback(async (code: string) => {
    const verifier = LS.get("pkce-verifier");
    const shopId   = LS.get("pkce-shop-id") || currentShop?.id || "1";
    if (!verifier) throw new Error("code_verifier não encontrado. Tente novamente.");

    const tokens = await exchangeCode(code, verifier);

    LS.del("pkce-verifier");
    LS.del("pkce-shop-id");

    LS.set(`ml-token-${shopId}`,   tokens.access_token);
    if (tokens.refresh_token) LS.set(`ml-refresh-${shopId}`, tokens.refresh_token);

    setToken(tokens.access_token);
    setShopId(shopId);

    const u = await ml("/users/me") as MLUser;
    setMlUser(u); setUserId(String(u.id)); setMlConnected(true);

    const shop: Shop    = currentShop || { id: shopId, name: u.nickname };
    const sessionUser   = user || u.nickname;
    const sessionShops  = shops.length ? shops : [shop];

    setUser(sessionUser);
    setCurrentShopSt(shop);
    setShops(sessionShops);

    persist({ user: sessionUser, userId: String(u.id), shops: sessionShops, currentShop: shop, mlConnected: true });
    await serverSave("ml-user", { id: u.id, nickname: u.nickname });
  }, [currentShop, user, shops, persist]);

  // ── Desconecta ML ────────────────────────────────────────────────────────
  const disconnectML = useCallback(() => {
    const shopId = currentShop?.id;
    if (shopId) { LS.del(`ml-token-${shopId}`); LS.del(`ml-refresh-${shopId}`); }
    setToken(""); setMlUser(null); setUserId(""); setMlConnected(false);
    persist({ user: user!, userId: "", shops, currentShop, mlConnected: false });
  }, [currentShop, user, shops, persist]);

  return (
    <AuthContext.Provider value={{
      user, userId, currentShop, shops, mlUser, mlConnected,
      login, logout, setCurrentShop, connectML, handleMLCallback, disconnectML,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
