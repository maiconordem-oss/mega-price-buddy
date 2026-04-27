import type { Product } from "@/types/marketplace";

export const MOCK_PRODUCTS: Product[] = [
  {
    sku: "SKU-001", name: "Fone Bluetooth Pro X2",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=F",
    cost: 45, shipping: 12, fullCost: 0, stCost: 0,
    mlItemId: "MLB1001",
    listing_type_id: "gold_pro",
    listings: [{ channel: "ml", currentPrice: 129.9, fee: 17 }],
  },
  {
    sku: "SKU-002", name: "Carregador Turbo USB-C 30W",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=C",
    cost: 22, shipping: 8, fullCost: 0, stCost: 0,
    mlItemId: "MLB1002",
    listing_type_id: "gold_special",
    listings: [{ channel: "ml", currentPrice: 59.9, fee: 12 }],
  },
  {
    sku: "SKU-003", name: "Capa Silicone iPhone 15",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=Cp",
    cost: 8, shipping: 6, fullCost: 0, stCost: 0,
    mlItemId: "MLB1003",
    listing_type_id: "gold_special",
    listings: [{ channel: "ml", currentPrice: 24.9, fee: 12 }],
  },
  {
    sku: "SKU-004", name: "Suporte Veicular Magnético",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=S",
    cost: 15, shipping: 10, fullCost: 0, stCost: 0,
    mlItemId: "MLB1004",
    listing_type_id: "gold_pro",
    listings: [{ channel: "ml", currentPrice: 39.9, fee: 17 }],
  },
  {
    sku: "SKU-005", name: "Smartwatch Fit Pulse",
    image: "https://placehold.co/64x64/2D3277/FFFFFF?text=Sw",
    cost: 95, shipping: 18, fullCost: 0, stCost: 0,
    mlItemId: "MLB1005",
    listing_type_id: "gold_pro",
    listings: [{ channel: "ml", currentPrice: 249.9, fee: 17 }],
  },
];
