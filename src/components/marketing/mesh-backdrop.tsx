import { cn } from '@/lib/utils';
import styles from './marketing.module.css';

/**
 * The hero's backdrop: three blurred brand-coloured light pools drifting slowly over a faint grid.
 * Pure CSS (no script, no images); decorative and ignored by assistive technology. The drift stops
 * for people who prefer reduced motion.
 */
export function MeshBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn(styles.mesh, className)}>
      <div className={styles.grid} />
      <div className={cn(styles.blob, styles.violet)} />
      <div className={cn(styles.blob, styles.cyan)} />
      <div className={cn(styles.blob, styles.indigo)} />
    </div>
  );
}
