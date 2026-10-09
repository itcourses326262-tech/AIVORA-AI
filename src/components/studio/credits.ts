/** What a request costs against what the person has: shared by the controls and the controller. */

export interface CreditStatus {
  /** What the request costs; null while there is no model to price. */
  cost: number | null;
  balance: number;
  /**
   * The session has ended, so the balance reads 0 for want of a user, not for want of credits. The
   * request is then left to the server, which answers "log in".
   */
  signedOut?: boolean;
}

/** The person cannot pay for the request: too few credits. */
export function isShort({ cost, balance, signedOut }: CreditStatus): boolean {
  return !signedOut && cost !== null && balance < cost;
}

/** Where to buy credits (the pricing page is built by another module). */
export const PRICING_HREF = '/pricing';
