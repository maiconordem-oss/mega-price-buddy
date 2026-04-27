export type Channel = "ml" | "shopee" | "amazon" | "magalu" | "tiktok";

export const CHANNELS: { id: Channel; name: string; short: string }[] = [
  { id: "ml", name: "Mercado Livre", short: "ML" },
  { id: "shopee", name: "Shopee", short: "Shopee" },
  { id: "amazon", name: "Amazon", short: "Amazon" },
  { id: "magalu", name: "Magalu", short: "Magalu" },
  { id: "tiktok", name: "TikTok Shop", short: "TikTok" },
];

export interface ChannelListing {
  channel: Channel;
  currentPrice: number;
  fee: number;
}

export interface Product {
  sku: string;
  name: string;
  image: string;
  // Custos editáveis por produto
  cost: number;       // custo do produto
  shipping: number;   // frete/taxa de envio (fr)
  fullCost: number;   // armazenagem full (fu)
  stCost: number;     // imposto ST
  // Configurações ML
  mlItemId?: string;
  listing_type_id?: string; // gold_pro, gold_special, etc
  // Preço promo manual
  promoPrice?: number;
  promoLocked?: boolean;
  // Margem mínima por produto (override global)
  marginTarget?: number;
  // Locks
  costLocked?: boolean;
  shippingLocked?: boolean;
  marginLocked?: boolean;
  listings: ChannelListing[];
}

/** Parâmetros Premium (tier 1) e Clássico (tier 2) separados */
export interface TierParams {
  commission: number; // comissão ML %
  ads: number;        // anúncios %
  returns: number;    // devolução %
  packaging: number;  // embalagem %
  tax: number;        // imposto NF %
}

export interface PricingParams {
  tier1: TierParams;  // Premium (gold_pro)
  tier2: TierParams;  // Clássico (gold_special)
  // Custos fixos padrão (editáveis por produto)
  defaultShipping: number;
  defaultFull: number;
  defaultST: number;
  targetMargin: number; // margem global padrão %
  // Legado — mantido para compatibilidade
  fees: Record<Channel, number>;
  tax: number;
  packaging: number;
}

export interface MarketplaceCredentials {
  ml: { connected: boolean };
  shopee: { partnerId: string; partnerKey: string; shopId: string; connected: boolean };
  amazon: { sellerId: string; authToken: string; marketplaceId: string; connected: boolean };
  magalu: { clientId: string; clientSecret: string; connected: boolean };
  tiktok: { appKey: string; appSecret: string; shopId: string; connected: boolean };
}
