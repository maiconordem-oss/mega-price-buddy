import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { loginUser, getMLToken, ml, setToken, setShopId } from "@/services/ml-api";

export interface Shop {
  id: string;
  name: string;
}

interface MLUser {
  id: number;
  nickname: string;
  email: string;
}

interface Ctx {
  user: string | null;
  userId: string;
  currentShop: Shop | null;
  shops: Shop[];
  mlUser: MLUser | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  setCurrentShop: (shop: Shop) => void;
  connectML: () => void;
  mlConnected: boolean;
}

const AuthContext = createContext<Ctx | null>(null);

// SHA-256 em browser puro
async function sha256hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const LS_KEY = "megalabs_auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [mlUser, setMlUser] = useState<MLUser | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [currentShop, setCurrentShopState] = useState<Shop | null>(null);
  const [mlConnected, setMlConnected] = useState(false);

  // Restaura sessão salva
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved) as {
          user: string;
          userId: string;
          shops: Shop[];
          currentShop: Shop;
          mlConnected: boolean;
        };
        setUser(s.user);
        setUserId(s.userId);
        setShops(s.shops || []);
        setCurrentShopState(s.currentShop || null);
        setMlConnected(s.mlConnected || false);
        if (s.currentShop?.id) {
          setShopId(s.currentShop.id);
          // Tenta rCarregar token ML
          getMLToken(s.currentShop.id).then((t) => {
            if (t) {
              setToken(t);
              ml("/users/me")
                .then((u) => {
                  const mu = u as MLUser;
                  setMlUser(mu);
                  setUserId(String(mu.id));
                })
                .catch(() => {});
            }
          });
        }
      } catch {}
    }
  }, []);

  const saveSession = (data: {
    user: string;
    userId: string;
    shops: Shop[];
    currentShop: Shop | null;
    mlConnected: boolean;
  }) => {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  };

  const login = async (username: string, password: string) => {
    // Tenta login real via token.php
    try {
      const hash = await sha256hex(password);
      const res = await loginUser(username, hash);
      if (res?.success || res?.ok) {
        const shopList: Shop[] = res.shops || [{ id: res.shop_id || "1", name: username }];
        const shop = shopList[0];
        setUser(username);
        setShops(shopList);
        setCurrentShopState(shop);
        setShopId(shop.id);
        saveSession({ user: username, userId: "", shops: shopList, currentShop: shop, mlConnected: false });
        // Tenta pegar token ML
        const t = await getMLToken(shop.id);
        if (t) {
          setToken(t);
          const u = await ml("/users/me").catch(() => null);
          if (u) {
            const mu = u as MLUser;
            setMlUser(mu);
            setUserId(String(mu.id));
            setMlConnected(true);
            saveSession({ user: username, userId: String(mu.id), shops: shopList, currentShop: shop, mlConnected: true });
          }
        }
        return { ok: true };
      }
      // Fallback: aceita qualquer login (modo demo)
      const shop = { id: "1", name: username };
      setUser(username);
      setShops([shop]);
      setCurrentShopState(shop);
      setShopId(shop.id);
      saveSession({ user: username, userId: "", shops: [shop], currentShop: shop, mlConnected: false });
      return { ok: true };
    } catch {
      // Modo offline/demo — aceita qualquer credencial
      const shop = { id: "1", name: username };
      setUser(username);
      setShops([shop]);
      setCurrentShopState(shop);
      saveSession({ user: username, userId: "", shops: [shop], currentShop: shop, mlConnected: false });
      return { ok: true };
    }
  };

  const logout = () => {
    setUser(null);
    setUserId("");
    setMlUser(null);
    setMlConnected(false);
    setCurrentShopState(null);
    setShops([]);
    setToken("");
    setShopId("");
    localStorage.removeItem(LS_KEY);
  };

  const setCurrentShop = (shop: Shop) => {
    setCurrentShopState(shop);
    setShopId(shop.id);
    saveSession({ user: user!, userId, shops, currentShop: shop, mlConnected });
  };

  const connectML = () => {
    // Abre fluxo OAuth ML — a URL de callback deve ser configurada no app ML
    const clientId = import.meta.env.VITE_ML_CLIENT_ID || "";
    const redirectUri = encodeURIComponent(window.location.origin + "/app");
    window.open(
      `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`,
      "_blank",
    );
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userId,
        currentShop,
        shops,
        mlUser,
        login,
        logout,
        setCurrentShop,
        connectML,
        mlConnected,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
