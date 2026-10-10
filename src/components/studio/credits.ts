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
  /**
   * The server wants a confirmed email address before this account may generate or buy credits, so
   * "get credits" would be the wrong advice whatever the balance reads. The notice asks for the
   * confirmation instead and Generate stays off.
   */
  unconfirmed?: boolean;
}

/** The person cannot pay for the request: too few credits (and confirming is not what is missing). */
export function isShort({ cost, balance, signedOut, unconfirmed }: CreditStatus): boolean {
  return !signedOut && unconfirmed !== true && cost !== null && balance < cost;
}

/** The account has to confirm its address first, whatever its balance. */
export function mustConfirmEmail({ signedOut, unconfirmed }: CreditStatus): boolean {
  return !signedOut && unconfirmed === true;
}

/** The notice that explains why Generate is off; the button points at it with `aria-describedby`. */
export const CONFIRM_NOTICE_ID = 'studio-confirm-email';

/** Where to buy credits (the pricing page is built by another module). */
export const PRICING_HREF = '/pricing';
