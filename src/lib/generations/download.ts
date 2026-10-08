import type { AssetDTO } from '@/lib/api-types';
import { downloadHref } from './media';

/** Saves one file: the media route answers `?download=1` with `Content-Disposition: attachment`. */
export function triggerDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Saves several results one after the other. Browsers ask before allowing many downloads at once
 * and drop clicks that arrive together, so each one waits a moment.
 */
export async function downloadAssets(assets: readonly AssetDTO[], gapMs = 300): Promise<void> {
  for (const [index, asset] of assets.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    triggerDownload(downloadHref(asset));
  }
}
