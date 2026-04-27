import { useMemo } from "react";
import type { Channel } from "@/types/marketplace";
import { useProducts } from "@/contexts/ProductsContext";

export function useMarketplace(channel: Channel | "all") {
  const { products } = useProducts();
  return useMemo(() => {
    if (channel === "all") return products;
    return products
      .filter((p) => p.listings.some((l) => l.channel === channel))
      .map((p) => ({ ...p, listings: p.listings.filter((l) => l.channel === channel) }));
  }, [products, channel]);
}
