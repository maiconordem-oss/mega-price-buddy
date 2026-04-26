import { createContext, useContext, useState, type ReactNode } from "react";
import type { Channel, MarketplaceCredentials } from "@/types/marketplace";

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

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<MarketplaceCredentials>(defaultCreds);

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
