import { useMemo } from "react";
import * as ml from "@/services/mercadolivre";
import * as shopee from "@/services/shopee";
import * as amazon from "@/services/amazon";
import * as magalu from "@/services/magalu";
import * as tiktok from "@/services/tiktokshop";
import type { Channel, Product } from "@/types/marketplace";
import { useProducts } from "@/contexts/ProductsContext";

const services = { ml, shopee, amazon, magalu, tiktok };

/** Merges products from all services by SKU */
export async function fetchAllProducts(): Promise<Product[]> {
  const results = await Promise.all(
    (Object.keys(services) as Channel[]).map((c) => services[c].getProducts()),
  );
  const map = new Map<string, Product>();
  for (const list of results) {
    for (const p of list) {
      const existing = map.get(p.sku);
      if (existing) {
        existing.listings = [...existing.listings, ...p.listings];
      } else {
        map.set(p.sku, { ...p, listings: [...p.listings] });
      }
    }
  }
  return Array.from(map.values());
}

export function useMarketplace(channel: Channel | "all") {
  const { products } = useProducts();
  return useMemo(() => {
    if (channel === "all") return products;
    return products
      .filter((p) => p.listings.some((l) => l.channel === channel))
      .map((p) => ({ ...p, listings: p.listings.filter((l) => l.channel === channel) }));
  }, [products, channel]);
}

export async function updatePriceOn(channel: Channel, sku: string, price: number) {
  return services[channel].updatePrice(sku, price);
}
