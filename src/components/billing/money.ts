/** Arithmetic on prices. Every amount is an integer number of halalas (1 SAR = 100 halalas). */

/** The price of 100 credits at an item's price, rounded to the nearest halala. */
export function halalasPer100Credits(priceHalalas: number, credits: number): number {
  if (credits <= 0) return 0;
  return Math.round((priceHalalas * 100) / credits);
}

/** The price without the VAT it contains (`vatHalalas` comes from the server with the price). */
export function netHalalas(priceHalalas: number, vatHalalas: number): number {
  return Math.max(0, priceHalalas - vatHalalas);
}
