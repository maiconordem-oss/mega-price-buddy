/**
 * Funções de precificação — porta exata do precif.html
 */
import type { PricingParams, Product } from "@/types/marketplace";

/** Soma de deduções para um tier (1=Premium, 2=Clássico) */
export function getTierDeductions(params: PricingParams, tier: 1 | 2): number {
  const t = tier === 1 ? params.tier1 : params.tier2;
  return (t.commission + t.ads + t.returns + t.packaging + t.tax) / 100;
}

/** Custos fixos de um produto (usa valor do produto ou padrão global) */
export function getFixed(product: Product, params: PricingParams) {
  const fr = product.shipping > 0 ? product.shipping : params.defaultShipping;
  const fu = product.fullCost > 0 ? product.fullCost : params.defaultFull;
  const st = product.stCost > 0 ? product.stCost : params.defaultST;
  return { fr, fu, st, total: fr + fu + st };
}

/** Margem mínima de um produto (por produto ou global) */
export function getMarginTarget(product: Product, params: PricingParams): number {
  if ((product.marginTarget ?? 0) > 0) return (product.marginTarget ?? 0) / 100;
  return params.targetMargin / 100;
}

/** Tier de anúncio: 1=Premium, 2=demais */
export function getTier(listingTypeId?: string): 1 | 2 {
  return listingTypeId === "gold_pro" ? 1 : 2;
}

/**
 * Preço Ideal = (Custo + Custos Fixos) / (1 - deduções% - margem%)
 */
export function calcIdeal(
  cost: number,
  fixedTotal: number,
  params: PricingParams,
  tier: 1 | 2,
  marginOverride?: number,
): number {
  const margin = marginOverride !== undefined ? marginOverride : params.targetMargin / 100;
  const ded = getTierDeductions(params, tier);
  const denom = 1 - ded - margin;
  if (denom <= 0) return 0;
  return (cost + fixedTotal) / denom;
}

/**
 * Lucro = Preço × (1 - deduções%) - Custo - Custos Fixos
 */
export function calcLucro(
  cost: number,
  fixedTotal: number,
  price: number,
  params: PricingParams,
  tier: 1 | 2,
): number {
  const ded = getTierDeductions(params, tier);
  return price * (1 - ded) - cost - fixedTotal;
}

/**
 * Margem % = Lucro / Preço
 */
export function calcMargin(
  cost: number,
  fixedTotal: number,
  price: number,
  params: PricingParams,
  tier: 1 | 2,
): number {
  if (price <= 0) return 0;
  return calcLucro(cost, fixedTotal, price, params, tier) / price;
}

/**
 * Calcula tudo para uma linha da tabela
 */
export interface PricingRow {
  tier: 1 | 2;
  effectivePrice: number; // preço promo ou normal
  fixed: { fr: number; fu: number; st: number; total: number };
  marginTarget: number;
  // Preços ideais
  idealP: number; // Premium
  idealC: number; // Clássico
  // Preços para cadastrar (÷ 0.75)
  cadP: number;
  cadC: number;
  // Margem e lucro atual
  margin: number;
  lucro: number;
  // Status
  status: "ok" | "low" | "nocost";
}

export function computePricingRow(product: Product, params: PricingParams): PricingRow {
  const cost = product.cost;
  const fixed = getFixed(product, params);
  const tier = getTier(product.listing_type_id);
  const marginTarget = getMarginTarget(product, params);
  const effectivePrice = (product.promoPrice ?? 0) > 0 ? product.promoPrice! : (product.listings[0]?.currentPrice ?? 0);

  if (!cost) {
    return {
      tier, effectivePrice, fixed, marginTarget,
      idealP: 0, idealC: 0, cadP: 0, cadC: 0,
      margin: 0, lucro: 0, status: "nocost",
    };
  }

  const idealP = calcIdeal(cost, fixed.total, params, 1, marginTarget);
  const idealC = calcIdeal(cost, fixed.total, params, 2, marginTarget);
  const margin = calcMargin(cost, fixed.total, effectivePrice, params, tier);
  const lucro = calcLucro(cost, fixed.total, effectivePrice, params, tier);

  return {
    tier, effectivePrice, fixed, marginTarget,
    idealP, idealC,
    cadP: idealP / 0.75,
    cadC: idealC / 0.75,
    margin, lucro,
    status: margin >= marginTarget ? "ok" : "low",
  };
}

export const BRL = (v: number) =>
  "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
