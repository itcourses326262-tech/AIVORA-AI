'use client';

import { Modal, type ModalCommonProps } from './modal';

export interface SheetProps extends ModalCommonProps {
  /** Edge it slides in from. `start`/`end` follow the reading direction. */
  side?: 'start' | 'end' | 'bottom';
}

/** A modal panel attached to an edge of the screen: the mobile menu, filters, details. */
export function Sheet({ side = 'end', ...props }: SheetProps) {
  return <Modal {...props} kind={`sheet-${side}`} />;
}
