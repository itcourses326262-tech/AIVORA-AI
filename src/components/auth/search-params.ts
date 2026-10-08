/** A query parameter that may arrive repeated (`?next=a&next=b`): the first value counts. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
