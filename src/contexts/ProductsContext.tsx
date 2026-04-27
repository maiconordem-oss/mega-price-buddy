import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { PricingParams, Product } from "@/types/marketplace";
import { MOCK_PRODUCTS } from "@/data/mockProducts";
import { getProducts as getMLProducts } from "@/services/mercadolivre";
import { serverSave, serverLoad } from "@/services/ml-api";
import { useAuth } from "./AuthContext";
import { toast } from "sonner";

const defaultParams: PricingParams = {
  fees: { ml: 16, shopee: 14, amazon: 15, magalu: 18, tiktok: 12 },
  tax: 8,
  packaging: 2.5,
  targetMargin: 25,
};

const PARAMS_KEY = "pricing-params";

interface Ctx {
  products: Product[];
  setProducts: (p: Product[]) => void;
  updateProduct: (sku: string, data: Partial<Product>) => void;
  params: PricingParams;
  setParams: (p: PricingParams) => void;
  loadMLProducts: (force?: boolean) => Promise<void>;
  loadingProducts: boolean;
}

const ProductsContext = createContext<Ctx | null>(null);

export function ProductsProvider({ children }: { children: ReactNode }) {
  const { userId, mlConnected } = useAuth();
  const [products, setProductsState] = useState<Product[]>(MOCK_PRODUCTS);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Params: tenta carregar do localStorage
  const [params, setParamsState] = useState<PricingParams>(() => {
    try {
      const saved = localStorage.getItem(PARAMS_KEY);
      if (saved) return { ...defaultParams, ...JSON.parse(saved) };
    } catch {}
    return defaultParams;
  });

  const setParams = (p: PricingParams) => {
    setParamsState(p);
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
    serverSave(PARAMS_KEY, p).catch(() => {});
  };

  const setProducts = (p: Product[]) => setProductsState(p);

  const updateProduct = useCallback((sku: string, data: Partial<Product>) => {
    setProductsState((prev) =>
      prev.map((p) => (p.sku === sku ? { ...p, ...data } : p)),
    );
  }, []);

  const loadMLProducts = useCallback(
    async (force = false) => {
      if (!mlConnected || !userId) {
        toast.info("Conecte o Mercado Livre nas Configurações para carregar produtos reais.");
        return;
      }

      // Tenta cache servidor primeiro
      if (!force) {
        try {
          const cached = await serverLoad<Product[]>("ml-products");
          if (cached?.data) {
            setProductsState(cached.data);
            return;
          }
        } catch {}
      }

      setLoadingProducts(true);
      try {
        // Mescla custo/frete já editados
        const current = products.reduce<Record<string, { cost: number; shipping: number }>>((acc, p) => {
          acc[p.sku] = { cost: p.cost, shipping: p.shipping };
          return acc;
        }, {});

        const mlProds = await getMLProducts(userId);
        const merged = mlProds.map((p) => ({
          ...p,
          cost: current[p.sku]?.cost ?? p.cost,
          shipping: current[p.sku]?.shipping ?? p.shipping,
        }));

        setProductsState(merged);
        serverSave("ml-products", merged).catch(() => {});
        toast.success(`${merged.length} produtos carregados do Mercado Livre`);
      } catch (e) {
        toast.error("Erro ao carregar produtos: " + (e as Error).message);
      } finally {
        setLoadingProducts(false);
      }
    },
    [userId, mlConnected, products],
  );

  return (
    <ProductsContext.Provider
      value={{ products, setProducts, updateProduct, params, setParams, loadMLProducts, loadingProducts }}
    >
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error("useProducts must be used within ProductsProvider");
  return ctx;
}
