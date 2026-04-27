import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { PricingParams, Product } from "@/types/marketplace";
import { MOCK_PRODUCTS } from "@/data/mockProducts";
import { getProducts as getMLProducts } from "@/services/mercadolivre";
import { serverSave, serverLoad } from "@/services/ml-api";
import { useAuth } from "./AuthContext";
import { toast } from "sonner";

const defaultTier = (commission: number) => ({
  commission,
  ads: 3.0,
  returns: 5.39,
  packaging: 0.84,
  tax: 9.5,
});

export const defaultParams: PricingParams = {
  tier1: defaultTier(17), // Premium
  tier2: defaultTier(12), // Clássico
  defaultShipping: 0,
  defaultFull: 0,
  defaultST: 0,
  targetMargin: 20,
  // legado
  fees: { ml: 17, shopee: 14, amazon: 15, magalu: 18, tiktok: 12 },
  tax: 9.5,
  packaging: 0.84,
};

const PARAMS_KEY = "pricing-params";
const PRODUCTS_KEY = "ml-products";

interface Ctx {
  products: Product[];
  setProducts: (p: Product[]) => void;
  updateProduct: (sku: string, data: Partial<Product>) => void;
  params: PricingParams;
  setParams: (p: PricingParams) => void;
  loadMLProducts: (force?: boolean) => Promise<void>;
  loadingProducts: boolean;
  saveProductCosts: () => void;
}

const ProductsContext = createContext<Ctx | null>(null);

export function ProductsProvider({ children }: { children: ReactNode }) {
  const { userId, mlConnected } = useAuth();
  const [products, setProductsState] = useState<Product[]>(MOCK_PRODUCTS);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [params, setParamsState] = useState<PricingParams>(() => {
    try {
      const saved = localStorage.getItem(PARAMS_KEY);
      if (saved) return { ...defaultParams, ...JSON.parse(saved) };
    } catch {}
    return defaultParams;
  });

  const setParams = useCallback((p: PricingParams) => {
    setParamsState(p);
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
    serverSave(PARAMS_KEY, p).catch(() => {});
  }, []);

  const setProducts = useCallback((p: Product[]) => setProductsState(p), []);

  const updateProduct = useCallback((sku: string, data: Partial<Product>) => {
    setProductsState((prev) =>
      prev.map((p) => (p.sku === sku ? { ...p, ...data } : p)),
    );
  }, []);

  /** Salva custos/configs de todos os produtos no servidor */
  const saveProductCosts = useCallback(() => {
    setProductsState((current) => {
      const costData = current.map((p) => ({
        sku: p.sku,
        mlItemId: p.mlItemId,
        cost: p.cost,
        shipping: p.shipping,
        fullCost: p.fullCost,
        stCost: p.stCost,
        promoPrice: p.promoPrice,
        promoLocked: p.promoLocked,
        marginTarget: p.marginTarget,
        costLocked: p.costLocked,
        shippingLocked: p.shippingLocked,
        marginLocked: p.marginLocked,
      }));
      serverSave("product-costs", costData).catch(() => {});
      return current;
    });
  }, []);

  const loadMLProducts = useCallback(
    async (force = false) => {
      if (!mlConnected || !userId) {
        toast.info("Conecte o Mercado Livre nas Configurações para carregar produtos reais.");
        return;
      }

      if (!force) {
        try {
          const cached = await serverLoad<Product[]>(PRODUCTS_KEY);
          if (cached?.data && Array.isArray(cached.data) && cached.data.length) {
            // Restaura custos salvos
            const costsRaw = await serverLoad<Array<{ sku: string } & Partial<Product>>>("product-costs");
            const costsMap: Record<string, Partial<Product>> = {};
            if (costsRaw?.data) {
              (costsRaw.data as Array<{ sku: string } & Partial<Product>>).forEach((c) => {
                costsMap[c.sku] = c;
              });
            }
            const merged = (cached.data as Product[]).map((p) => ({
              ...p,
              ...costsMap[p.sku],
            }));
            setProductsState(merged);
            toast.success(`${merged.length} produtos carregados do cache`);
            // Atualiza preços em background
            refreshPricesBackground(merged);
            return;
          }
        } catch {}
      }

      setLoadingProducts(true);
      try {
        const mlProds = await getMLProducts(userId);

        // Restaura custos salvos
        const costsRaw = await serverLoad<Array<{ sku: string } & Partial<Product>>>("product-costs");
        const costsMap: Record<string, Partial<Product>> = {};
        if (costsRaw?.data) {
          (costsRaw.data as Array<{ sku: string } & Partial<Product>>).forEach((c) => {
            costsMap[c.sku] = c;
          });
        }

        const merged = mlProds.map((p) => ({
          ...p,
          fullCost: 0,
          stCost: 0,
          ...costsMap[p.sku],
        }));

        setProductsState(merged);
        serverSave(PRODUCTS_KEY, merged).catch(() => {});
        toast.success(`${merged.length} produtos carregados do Mercado Livre`);
      } catch (e) {
        toast.error("Erro ao carregar produtos: " + (e as Error).message);
      } finally {
        setLoadingProducts(false);
      }
    },
    [userId, mlConnected],
  );

  const refreshPricesBackground = async (current: Product[]) => {
    try {
      if (!userId) return;
      const mlProds = await getMLProducts(userId);
      setProductsState((prev) =>
        prev.map((p) => {
          const fresh = mlProds.find((m) => m.mlItemId === p.mlItemId);
          if (!fresh) return p;
          return {
            ...p,
            listings: fresh.listings,
            listing_type_id: fresh.listing_type_id,
            name: fresh.name,
            image: fresh.image,
          };
        }),
      );
    } catch {}
  };

  return (
    <ProductsContext.Provider
      value={{ products, setProducts, updateProduct, params, setParams, loadMLProducts, loadingProducts, saveProductCosts }}
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
