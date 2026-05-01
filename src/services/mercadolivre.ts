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
  seller_custom_field: string | null;
  shipping: { free_shipping: boolean };
  attributes?: Array<{ id: string; value_name?: string }>;
}

async function fetchAllItemIds(userId: string): Promise<string[]> {
  const ids: string[] = [];

  // Busca active E paused — produtos sem estoque ficam como paused mas
  // ainda têm histórico de vendas e devem aparecer na Curva ABC
  for (const status of ["active", "paused"]) {
    let offset = 0;
    const limit = 50;
    while (true) {
      const data = await ml(
        `/users/${userId}/items/search?status=${status}&limit=${limit}&offset=${offset}`
      ) as { results: string[]; paging: { total: number } };
      ids.push(...data.results);
      if (ids.length >= data.paging.total || data.results.length < limit) break;
      offset += limit;
    }
  }

  // Remove duplicatas (improvável mas seguro)
  return [...new Set(ids)];
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
  const sku = (item.attributes || []).find((a) => a.id === "SELLER_SKU")?.value_name || item.id;
  return {
    sku,
    name: item.title,
    image: (item.thumbnail || "").replace("http:", "https:"),
    cost: 0,
    shipping: 0,
    fullCost: 0,
    stCost: 0,
    mlItemId: item.id,
    listing_type_id: item.listing_type_id,
    // Salva status e estoque para uso na UI (sem estoque = paused)
    available_quantity: item.available_quantity,
    status: item.status,
    listings: [{ channel: "ml" as const, currentPrice: item.price, fee: item.listing_type_id === "gold_pro" ? 17 : 12 }],
  } as Product;
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
