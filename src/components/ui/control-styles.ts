/** Shared look of text-like form controls (Input box, Textarea box, Select). */
export const CONTROL_BOX =
  'w-full rounded-lg border bg-surface text-foreground transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-subtle hover:border-muted';

export const CONTROL_BORDER = 'border-field';
export const CONTROL_BORDER_INVALID = 'border-danger hover:border-danger';

export const CONTROL_FOCUS =
  'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30 focus-within:hover:border-ring';

export const CONTROL_DISABLED =
  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:disabled]:hover:border-field';

export const CONTROL_SIZES = {
  sm: 'min-h-8 text-sm pointer-coarse:min-h-11',
  md: 'min-h-10 text-sm pointer-coarse:min-h-11',
  lg: 'min-h-12 text-base',
} as const;

export type ControlSize = keyof typeof CONTROL_SIZES;
