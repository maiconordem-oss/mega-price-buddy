import { ml, proxyPost, chunks } from "./ml-api";
import type { Product } from "@/types/marketplace";

interface MLItemDetail {
  id: string;
  title: string;
  price: number;
  thumbnail: string;
  listing_type_id: string;
  available_quantity: number;
  status: string;
  permalink: string;
  seller_custom_field: string | null;
  shipping: { free_shipping: boolean; mode: string };
}

function feeByListingType(t: string): number {
  const fees: Record<string, number> = {
    gold_pro: 16, gold_premium: 13, gold_special: 11,
    gold: 9, silver: 6, free: 0,
  };
  return fees[t] ?? 11;
}

async function fetchAllItemIds(userId: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 50;
  while (true) {
    const data = await ml(`/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`) as { results: string[]; paging: { total: number } };
    ids.push(...data.results);
    if (ids.length >= data.paging.total || data.results.length < limit) break;
    offset += limit;
  }
  return ids;
}

async function fetchItemDetails(ids: string[]): Promise<MLItemDetail[]> {
  const results: MLItemDetail[] = [];
  for (const batch of chunks(ids, 20)) {
    const data = await ml(`/items?ids=${batch.join(",")}`) as Array<{ code: number; body: MLItemDetail }>;
    data.forEach((r) => r.code === 200 && r.body && results.push(r.body));
  }
  return results;
}

function toProduct(item: MLItemDetail): Product {
  return {
    sku: item.seller_custom_field || item.id,
    name: item.title,
    image: (item.thumbnail || "").replace("http:", "https:"),
    cost: 0,
    shipping: item.shipping?.free_shipping ? 0 : 15,
    mlItemId: item.id,
    listings: [{ channel: "ml" as const, currentPrice: item.price, fee: feeByListingType(item.listing_type_id) }],
  };
}

export async function getProducts(userId: string): Promise<Product[]> {
  if (!userId) return [];
  const ids = await fetchAllItemIds(userId);
  if (!ids.length) return [];
  const details = await fetchItemDetails(ids);
  return details.map(toProduct);
}

export async function updatePrice(itemId: string, price: number): Promise<{ ok: boolean }> {
  await proxyPost("PUT", `/items/${itemId}`, { price });
  return { ok: true };
}
