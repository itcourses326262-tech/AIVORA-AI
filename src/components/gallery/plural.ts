import type { PluralForms, TFunction } from '@/lib/i18n';

/** The dictionary entries that are a sentence about a number: each has all six plural forms. */
export type CountMessage =
  | 'gallery.list.shown'
  | 'gallery.select.count'
  | 'gallery.select.deleted'
  | 'gallery.select.favorited'
  | 'gallery.select.unfavorited';

/** The six forms of one counted message, ready for `plural(count, forms)`. */
export function countForms(t: TFunction, message: CountMessage): PluralForms {
  return {
    zero: t(`${message}.zero`),
    one: t(`${message}.one`),
    two: t(`${message}.two`),
    few: t(`${message}.few`),
    many: t(`${message}.many`),
    other: t(`${message}.other`),
  };
}
