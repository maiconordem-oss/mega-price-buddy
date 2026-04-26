import { createContext, useContext, useState, type ReactNode } from "react";
import type { PricingParams, Product } from "@/types/marketplace";
import { MOCK_PRODUCTS } from "@/data/mockProducts";

const defaultParams: PricingParams = {
  fees: { ml: 16, shopee: 14, amazon: 15, magalu: 18, tiktok: 12 },
  tax: 8,
  packaging: 2.5,
  targetMargin: 25,
};

interface Ctx {
  products: Product[];
  setProducts: (p: Product[]) => void;
  params: PricingParams;
  setParams: (p: PricingParams) => void;
}

const ProductsContext = createContext<Ctx | null>(null);

export function ProductsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [params, setParams] = useState<PricingParams>(defaultParams);

  return (
    <ProductsContext.Provider value={{ products, setProducts, params, setParams }}>
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProducts must be used within ProductsProvider");
  return ctx;
}
