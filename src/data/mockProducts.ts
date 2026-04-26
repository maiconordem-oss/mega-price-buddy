import type { Product } from "@/types/marketplace";

export const MOCK_PRODUCTS: Product[] = [
  {
    sku: "SKU-001",
    name: "Fone Bluetooth Pro X2",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=F",
    cost: 45,
    shipping: 12,
    listings: [
      { channel: "ml", currentPrice: 129.9, fee: 16 },
      { channel: "shopee", currentPrice: 119.9, fee: 14 },
      { channel: "amazon", currentPrice: 134.9, fee: 15 },
    ],
  },
  {
    sku: "SKU-002",
    name: "Carregador Turbo USB-C 30W",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=C",
    cost: 22,
    shipping: 8,
    listings: [
      { channel: "ml", currentPrice: 59.9, fee: 16 },
      { channel: "magalu", currentPrice: 64.9, fee: 18 },
    ],
  },
  {
    sku: "SKU-003",
    name: "Capa Silicone iPhone 15",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=Cp",
    cost: 8,
    shipping: 6,
    listings: [
      { channel: "shopee", currentPrice: 24.9, fee: 14 },
      { channel: "tiktok", currentPrice: 27.9, fee: 12 },
    ],
  },
  {
    sku: "SKU-004",
    name: "Suporte Veicular Magnético",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=S",
    cost: 15,
    shipping: 10,
    listings: [
      { channel: "ml", currentPrice: 39.9, fee: 16 },
      { channel: "amazon", currentPrice: 42.9, fee: 15 },
      { channel: "magalu", currentPrice: 38.9, fee: 18 },
    ],
  },
  {
    sku: "SKU-005",
    name: "Smartwatch Fit Pulse",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=Sw",
    cost: 95,
    shipping: 18,
    listings: [
      { channel: "ml", currentPrice: 249.9, fee: 16 },
      { channel: "shopee", currentPrice: 229.9, fee: 14 },
      { channel: "tiktok", currentPrice: 239.9, fee: 12 },
    ],
  },
];
