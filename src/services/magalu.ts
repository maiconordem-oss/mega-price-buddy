import type { Product } from "@/types/marketplace";

export async function getProducts(): Promise<Product[]> {
  return [];
}

export async function updatePrice(sku: string, price: number): Promise<{ ok: boolean }> {
  console.log("[Magalu] updatePrice", sku, price);
  return { ok: true };
}
