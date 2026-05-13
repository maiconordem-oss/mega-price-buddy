import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import type { Channel, MarketplaceCredentials } from "@/types/marketplace";
import { useAuth } from "@/contexts/AuthContext";
import { kvSave, kvLoad } from "@/server/kv";

const defaultCreds: MarketplaceCredentials = {
  ml: { connected: false },
  shopee: { partnerId: "", partnerKey: "", shopId: "", connected: false },
  amazon: { sellerId: "", authToken: "", marketplaceId: "", connected: false },
  magalu: { clientId: "", clientSecret: "", connected: false },
  tiktok: { appKey: "", appSecret: "", shopId: "", connected: false },
};

interface Ctx {
  credentials: MarketplaceCredentials;
  updateCredential: <K extends Channel>(channel: K, data: Partial<MarketplaceCredentials[K]>) => void;
  setConnected: (channel: Channel, connected: boolean) => void;
}

const CredentialsContext = createContext<Ctx | null>(null);

const LS_KEY = "megalabs_marketplace_creds";

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [credentials, setCredentials] = useState<MarketplaceCredentials>(defaultCreds);
  const loadedFor = useRef<string | null>(null);
  const hydrated = useRef(false);

  // ── carrega credenciais do servidor (KV) por usuário ────────────────────
  useEffect(() => {
    if (!user) {
      hydrated.current = false;
      loadedFor.current = null;
      setCredentials(defaultCreds);
      return;
    }
    if (loadedFor.current === user) return;
    loadedFor.current = user;
    hydrated.current = false;

    (async () => {
      // tenta KV primeiro
      try {
        const raw = await kvLoad({ data: { userId: user, shopId: "_session", key: "marketplace-creds" } });
        if (raw) {
          const parsed = JSON.parse(raw) as { data: MarketplaceCredentials };
          if (parsed?.data) {
            setCredentials({ ...defaultCreds, ...parsed.data });
            hydrated.current = true;
            return;
          }
        }
      } catch {}
      // fallback localStorage
      try {
        const local = localStorage.getItem(`${LS_KEY}:${user}`);
        if (local) setCredentials({ ...defaultCreds, ...JSON.parse(local) });
      } catch {}
      hydrated.current = true;
    })();
  }, [user]);

  // ── persiste qualquer mudança no KV + cache local ───────────────────────
  useEffect(() => {
    if (!user || !hydrated.current) return;
    try { localStorage.setItem(`${LS_KEY}:${user}`, JSON.stringify(credentials)); } catch {}
    kvSave({ data: { userId: user, shopId: "_session", key: "marketplace-creds", value: credentials } })
      .catch(() => {});
  }, [credentials, user]);

  const updateCredential: Ctx["updateCredential"] = (channel, data) => {
    setCredentials((prev) => ({ ...prev, [channel]: { ...prev[channel], ...data } }));
  };
  const setConnected = (channel: Channel, connected: boolean) => {
    setCredentials((prev) => ({ ...prev, [channel]: { ...prev[channel], connected } }));
  };

  return (
    <CredentialsContext.Provider value={{ credentials, updateCredential, setConnected }}>
      {children}
    </CredentialsContext.Provider>
  );
}

export function useCredentials() {
  const ctx = useContext(CredentialsContext);
  if (!ctx) throw new Error("useCredentials must be used within CredentialsProvider");
  return ctx;
}
