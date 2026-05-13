import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
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

const PRODUCTS_KEY = "ml-products";

// params são por conta (shopId), não globais
function paramsKey(shopId: string) { return `pricing-params:${shopId}` }

function loadParamsForShop(shopId: string): PricingParams {
  try {
    const saved = localStorage.getItem(paramsKey(shopId));
    if (saved) return { ...defaultParams, ...JSON.parse(saved) };
  } catch {}
  return defaultParams;
}

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
  const { userId, mlConnected, currentShop } = useAuth();
  const shopId = currentShop?.id ?? "default";

  // Inicia vazio — MOCK_PRODUCTS só aparecem quando explicitamente solicitado
  // para não confundir com produtos reais do ML
  const [products, setProductsState] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [params, setParamsState] = useState<PricingParams>(() => loadParamsForShop(shopId));

  // Referência para saber qual conta estava ativa antes
  const prevShopId = useRef(shopId);

  // ── Reset completo ao trocar de conta ─────────────────────────────────
  useEffect(() => {
    if (prevShopId.current === shopId) return;
    prevShopId.current = shopId;

    // Limpa produtos e carrega params da nova conta
    setProductsState([]);
    setParamsState(loadParamsForShop(shopId));
  }, [shopId]);

  const setParams = useCallback((p: PricingParams) => {
    setParamsState(p);
    localStorage.setItem(paramsKey(shopId), JSON.stringify(p));
    serverSave("pricing-params", p).catch(() => {});
  }, [shopId]);

  const setProducts = useCallback((p: Product[]) => setProductsState(p), []);

  const updateProduct = useCallback((sku: string, data: Partial<Product>) => {
    setProductsState((prev) =>
      prev.map((p) => (p.sku === sku ? { ...p, ...data } : p)),
    );
  }, []);

  /** Salva custos/configs de todos os produtos no servidor (isolado por shopId via serverSave) */
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
            refreshPricesBackground(merged);
            return;
          }
        } catch {}
      }

      setLoadingProducts(true);
      try {
        const mlProds = await getMLProducts(userId);

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

      // Carrega custos para mesclar nos produtos novos que não estavam no cache
      let costsMap: Record<string, Partial<Product>> = {};
      try {
        const costsRaw = await serverLoad<Array<{ sku: string } & Partial<Product>>>("product-costs");
        if (costsRaw?.data) {
          (costsRaw.data as Array<{ sku: string } & Partial<Product>>).forEach(c => { costsMap[c.sku] = c; });
        }
      } catch {}

      setProductsState((prev) => {
        const prevIds = new Set(prev.map(p => p.mlItemId).filter(Boolean));

        // Atualiza produtos existentes (preço, nome, imagem, tier)
        const updated = prev.map((p) => {
          const fresh = mlProds.find((m) => m.mlItemId === p.mlItemId);
          if (!fresh) return p;
          return {
            ...p,
            listings: fresh.listings,
            listing_type_id: fresh.listing_type_id,
            name: fresh.name,
            image: fresh.image,
            available_quantity: fresh.available_quantity,
            status: (fresh as any).status,
          };
        });

        // Adiciona produtos do ML que não estavam no cache
        // (ex: produto pausado antes do cache ser criado, ou novo produto)
        const newProds = mlProds
          .filter(m => m.mlItemId && !prevIds.has(m.mlItemId))
          .map(p => ({ ...p, fullCost: 0, stCost: 0, ...costsMap[p.sku] }));

        if (!newProds.length) return updated;

        const merged = [...updated, ...newProds];
        serverSave(PRODUCTS_KEY, merged).catch(() => {}); // persiste cache atualizado
        return merged;
      });
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
