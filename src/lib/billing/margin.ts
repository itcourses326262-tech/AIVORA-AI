import { DEFAULT_VAT_RATE_PERCENT, splitVat } from './plans';

/** Assumptions behind the price table in `./plans.ts`. Change them with the numbers they explain. */
export const UPSTREAM_USD_PER_CREDIT = 0.004;
export const SAR_PER_USD = 3.75;
/** Pessimistic gateway cost: a share of the price plus a fixed amount per payment. */
export const GATEWAY_FEE_RATE = 0.03;
export const GATEWAY_FIXED_FEE_HALALAS = 100;
/** Net revenue divided by the upstream cost of the credits sold. */
export const TARGET_MARGIN_MULTIPLE = 2.5;

export interface MarginInput {
  priceHalalas: number;
  credits: number;
  vatPercent?: number;
}

export interface MarginReport {
  /** Price per credit in SAR, VAT included. */
  pricePerCreditSar: number;
  vatHalalas: number;
  /** Price minus VAT minus the gateway's cut, in halalas. */
  netHalalas: number;
  /** Upstream cost of all the credits at the anchor price, in halalas. */
  upstreamCostHalalas: number;
  /** `netHalalas / upstreamCostHalalas`. */
  multiple: number;
  meetsTarget: boolean;
}

export function marginOf({
  priceHalalas,
  credits,
  vatPercent = DEFAULT_VAT_RATE_PERCENT,
}: MarginInput): MarginReport {
  const { vatHalalas } = splitVat(priceHalalas, vatPercent);
  const gatewayHalalas = priceHalalas * GATEWAY_FEE_RATE + GATEWAY_FIXED_FEE_HALALAS;
  const netHalalas = priceHalalas - vatHalalas - gatewayHalalas;
  const upstreamCostHalalas = credits * UPSTREAM_USD_PER_CREDIT * SAR_PER_USD * 100;
  const multiple = netHalalas / upstreamCostHalalas;
  return {
    pricePerCreditSar: priceHalalas / 100 / credits,
    vatHalalas,
    netHalalas,
    upstreamCostHalalas,
    multiple,
    meetsTarget: multiple >= TARGET_MARGIN_MULTIPLE,
  };
}
