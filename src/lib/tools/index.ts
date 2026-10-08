import type { Kind, Tool } from '@/lib/catalog/types';

export interface ToolSpec {
  id: Tool;
  kind: Kind;
  needsInputImage: boolean;
  /** lucide-react icon name in kebab-case. */
  icon: string;
  /** Prefix of the tool's messages: `<i18nKey>.name` and `<i18nKey>.description`. */
  i18nKey: string;
}

const TOOL_SPECS: readonly ToolSpec[] = [
  {
    id: 'text-to-image',
    kind: 'image',
    needsInputImage: false,
    icon: 'image',
    i18nKey: 'common.tools.textToImage',
  },
  {
    id: 'image-to-image',
    kind: 'image',
    needsInputImage: true,
    icon: 'image-plus',
    i18nKey: 'common.tools.imageToImage',
  },
  {
    id: 'text-to-video',
    kind: 'video',
    needsInputImage: false,
    icon: 'clapperboard',
    i18nKey: 'common.tools.textToVideo',
  },
  {
    id: 'image-to-video',
    kind: 'video',
    needsInputImage: true,
    icon: 'image-play',
    i18nKey: 'common.tools.imageToVideo',
  },
];

export function getTools(): ToolSpec[] {
  return TOOL_SPECS.map((tool) => ({ ...tool }));
}

export function getTool(id: Tool): ToolSpec | undefined {
  const tool = TOOL_SPECS.find((candidate) => candidate.id === id);
  return tool ? { ...tool } : undefined;
}
