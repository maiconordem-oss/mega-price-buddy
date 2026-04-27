import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { serverSave, serverLoad, ml, setToken, setShopId, PROXY_URL } from "@/services/ml-api";

export interface Shop {
  id: string;
  name: string;
}

export interface MLUser {
  id: number;
  nickname: string;
  email?: string;
  country_id?: string;
}

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

// ── PKCE helpers (idêntico ao precif.html) ──────────────────────────────────
function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function randStr(len: number) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a.buffer);
}
async function sha256b64url(str: string) {
  const enc = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest("SHA-256", enc);
  return b64url(h);
}
async function sha256hex(str: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Constantes ML ────────────────────────────────────────────────────────────
// Client ID da nova aplicação — lido do .env
const ML_CLIENT_ID = import.meta.env.VITE_ML_CLIENT_ID || "";

// Redirect URI: /auth/callback no mesmo domínio
function getRedirectUri() {
  return window.location.origin + "/auth/callback";
}

// ── LocalStorage helpers ─────────────────────────────────────────────────────
const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k: string) => { try { localStorage.removeItem(k); } catch {} },
};

const SESSION_KEY = "megalabs_session";

interface Session {
  user: string;
  userId: string;
  shops: Shop[];
  currentShop: Shop | null;
  mlConnected: boolean;
}

// ── AuthProvider ─────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [mlUser, setMlUser] = useState<MLUser | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [currentShop, setCurrentShopState] = useState<Shop | null>(null);
  const [mlConnected, setMlConnected] = useState(false);

  // Salva sessão no localStorage
  const persistSession = useCallback((data: Session) => {
    LS.set(SESSION_KEY, JSON.stringify(data));
  }, []);

  // ── Restaura sessão ao iniciar ──────────────────────────────────────────────
  useEffect(() => {
    const raw = LS.get(SESSION_KEY);
    if (!raw) return;
    try {
      const s: Session = JSON.parse(raw);
      setUser(s.user);
      setUserId(s.userId || "");
      setShops(s.shops || []);
      setCurrentShopState(s.currentShop || null);
      setMlConnected(s.mlConnected || false);

      if (s.currentShop?.id) {
        setShopId(s.currentShop.id);
        // Tenta restaurar token ML
        const shopId = s.currentShop.id;
        const savedToken = LS.get(`ml-token-shop-${shopId}`);
        if (savedToken) {
          setToken(savedToken);
          ml("/users/me")
            .then((u) => {
              const mu = u as MLUser;
              setMlUser(mu);
              setUserId(String(mu.id));
              setMlConnected(true);
            })
            .catch(() => {
              // Token expirado — tenta refresh
              const rt = LS.get(`ml-refresh-shop-${shopId}`);
              if (rt) refreshToken(rt, shopId).catch(() => {});
            });
        }
      }
    } catch {}
  }, []);

  // ── Refresh de token ML ─────────────────────────────────────────────────────
  const refreshToken = async (refreshToken: string, shopId: string) => {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refresh_token: refreshToken, shop_id: shopId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "Erro ao renovar token");
    if (data.refresh_token) LS.set(`ml-refresh-shop-${shopId}`, data.refresh_token);
    LS.set(`ml-token-shop-${shopId}`, data.access_token);
    setToken(data.access_token);
    const u = await ml("/users/me") as MLUser;
    setMlUser(u);
    setUserId(String(u.id));
    setMlConnected(true);
    return data.access_token;
  };

  // ── Login sistema (MegaLabs) ────────────────────────────────────────────────
  const login = useCallback(async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const hash = await sha256hex(password);
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", usuario: username, senha_hash: hash }),
      });
      const data = await res.json().catch(() => ({}));

      // Determina lojas
      let shopList: Shop[] = [];
      if (data?.shops?.length) {
        shopList = data.shops;
      } else if (data?.shop_id) {
        shopList = [{ id: String(data.shop_id), name: username }];
      } else {
        // Fallback — aceita qualquer login (modo demo/offline)
        shopList = [{ id: "1", name: username }];
      }

      const shop = shopList[0];
      setUser(username);
      setShops(shopList);
      setCurrentShopState(shop);
      setShopId(shop.id);

      const session: Session = { user: username, userId: "", shops: shopList, currentShop: shop, mlConnected: false };

      // Tenta carregar token ML já salvo para esta loja
      const savedToken = LS.get(`ml-token-shop-${shop.id}`);
      if (savedToken) {
        try {
          setToken(savedToken);
          const u = await ml("/users/me") as MLUser;
          setMlUser(u);
          setUserId(String(u.id));
          setMlConnected(true);
          session.userId = String(u.id);
          session.mlConnected = true;
        } catch {
          LS.del(`ml-token-shop-${shop.id}`);
        }
      }

      persistSession(session);
      return { ok: true };
    } catch (e) {
      // Modo offline — aceita qualquer credencial
      const shop = { id: "1", name: username };
      setUser(username);
      setShops([shop]);
      setCurrentShopState(shop);
      setShopId(shop.id);
      persistSession({ user: username, userId: "", shops: [shop], currentShop: shop, mlConnected: false });
      return { ok: true };
    }
  }, [persistSession]);

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null);
    setUserId("");
    setMlUser(null);
    setMlConnected(false);
    setCurrentShopState(null);
    setShops([]);
    setToken("");
    setShopId("");
    LS.del(SESSION_KEY);
  }, []);

  // ── Troca de loja ───────────────────────────────────────────────────────────
  const setCurrentShop = useCallback((shop: Shop) => {
    // Salva token atual antes de trocar
    const curShopId = currentShop?.id;
    if (curShopId) {
      // já está salvo no LS individualmente
    }

    setCurrentShopState(shop);
    setShopId(shop.id);

    // Restaura token da nova loja
    const savedToken = LS.get(`ml-token-shop-${shop.id}`);
    if (savedToken) {
      setToken(savedToken);
      ml("/users/me")
        .then((u) => { const mu = u as MLUser; setMlUser(mu); setUserId(String(mu.id)); setMlConnected(true); })
        .catch(() => { setMlConnected(false); setToken(""); });
    } else {
      setToken("");
      setMlConnected(false);
      setMlUser(null);
      setUserId("");
    }

    persistSession({ user: user!, userId, shops, currentShop: shop, mlConnected: !!savedToken });
  }, [currentShop, user, userId, shops, persistSession]);

  // ── Inicia OAuth ML (PKCE — idêntico ao precif.html) ────────────────────────
  const connectML = useCallback(() => {
    if (!ML_CLIENT_ID) {
      alert("VITE_ML_CLIENT_ID não configurado.\nAdicione no arquivo .env e faça o deploy.");
      return;
    }

    const verifier = randStr(48);
    LS.set("pkce-verifier", verifier);
    LS.set("pkce-shop-id", currentShop?.id || "1");

    sha256b64url(verifier).then((challenge) => {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: ML_CLIENT_ID,
        redirect_uri: getRedirectUri(),
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: "offline_access read write",
      });
      window.location.href = "https://auth.mercadolivre.com.br/authorization?" + params.toString();
    });
  }, [currentShop]);

  // ── Callback OAuth — troca código por token ──────────────────────────────────
  const handleMLCallback = useCallback(async (code: string) => {
    const verifier = LS.get("pkce-verifier");
    const shopId = LS.get("pkce-shop-id") || currentShop?.id || "1";

    if (!verifier) throw new Error("code_verifier não encontrado. Tente fazer login novamente.");

    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange",
        code,
        code_verifier: verifier,
        shop_id: shopId,
        redirect_uri: getRedirectUri(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Erro HTTP ${res.status}`);

    LS.del("pkce-verifier");
    LS.del("pkce-shop-id");

    const accessToken: string = data.access_token;
    if (!accessToken) throw new Error("Token não retornado pelo servidor.");

    // Salva tokens no slot da loja
    LS.set(`ml-token-shop-${shopId}`, accessToken);
    if (data.refresh_token) LS.set(`ml-refresh-shop-${shopId}`, data.refresh_token);

    setToken(accessToken);
    setShopId(shopId);

    // Busca dados do usuário
    const u = await ml("/users/me") as MLUser;
    setMlUser(u);
    setUserId(String(u.id));
    setMlConnected(true);

    // Atualiza sessão
    const session: Session = {
      user: user || u.nickname,
      userId: String(u.id),
      shops,
      currentShop: currentShop || { id: shopId, name: u.nickname },
      mlConnected: true,
    };
    persistSession(session);

    // Salva token também no servidor (para uso pelo token.php)
    await serverSave("ml-access-token", { token: accessToken, userId: u.id }).catch(() => {});
  }, [currentShop, user, shops, persistSession]);

  // ── Desconecta ML ───────────────────────────────────────────────────────────
  const disconnectML = useCallback(() => {
    const shopId = currentShop?.id;
    if (shopId) {
      LS.del(`ml-token-shop-${shopId}`);
      LS.del(`ml-refresh-shop-${shopId}`);
    }
    setToken("");
    setMlUser(null);
    setUserId("");
    setMlConnected(false);
    persistSession({ user: user!, userId: "", shops, currentShop, mlConnected: false });
  }, [currentShop, user, shops, persistSession]);

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
