import type { Tool } from '@/lib/api-types';
import type { MessageKey } from '@/lib/i18n';

/** The dictionary entry that names each tool, for the "Tool" line of a details list. */
export const TOOL_NAME: Record<Tool, MessageKey> = {
  'text-to-image': 'common.tools.textToImage.name',
  'image-to-image': 'common.tools.imageToImage.name',
  'text-to-video': 'common.tools.textToVideo.name',
  'image-to-video': 'common.tools.imageToVideo.name',
};
