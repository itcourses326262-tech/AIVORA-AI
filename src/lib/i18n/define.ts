/**
 * Type-forcing helper for message dictionaries. It lives apart from `index.ts` because `index.ts`
 * imports every dictionary: a dictionary importing it back would create an import cycle.
 */

export interface MessageTree {
  readonly [key: string]: string | MessageTree;
}

export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

/**
 * Declares both languages of one namespace. `ar` must have exactly the keys of `en`, at every depth;
 * a missing or extra key is a compile error.
 */
export function defineMessages<T extends MessageTree>(messages: {
  en: T;
  ar: NoInfer<Shape<T>>;
}): { en: T; ar: Shape<T> } {
  return messages;
}
