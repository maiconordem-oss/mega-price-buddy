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
  fee: number; // %
}

export interface Product {
  sku: string;
  name: string;
  image: string;
  cost: number;
  shipping: number;
  listings: ChannelListing[];
}

export interface PricingParams {
  fees: Record<Channel, number>;
  tax: number;
  packaging: number;
  targetMargin: number;
}

export interface MarketplaceCredentials {
  ml: { connected: boolean };
  shopee: { partnerId: string; partnerKey: string; shopId: string; connected: boolean };
  amazon: { sellerId: string; authToken: string; marketplaceId: string; connected: boolean };
  magalu: { clientId: string; clientSecret: string; connected: boolean };
  tiktok: { appKey: string; appSecret: string; shopId: string; connected: boolean };
}
