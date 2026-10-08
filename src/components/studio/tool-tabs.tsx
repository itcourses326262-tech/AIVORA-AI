'use client';

import {
  Clapperboard,
  Image as ImageIcon,
  ImagePlay,
  ImagePlus,
  type LucideIcon,
} from 'lucide-react';
import type { Tool } from '@/lib/catalog/types';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { TabsList, TabsTrigger } from '../ui/tabs';

const TOOL_META: ReadonlyArray<{ tool: Tool; icon: LucideIcon; name: MessageKey }> = [
  { tool: 'text-to-image', icon: ImageIcon, name: 'common.tools.textToImage.name' },
  { tool: 'image-to-image', icon: ImagePlus, name: 'common.tools.imageToImage.name' },
  { tool: 'text-to-video', icon: Clapperboard, name: 'common.tools.textToVideo.name' },
  { tool: 'image-to-video', icon: ImagePlay, name: 'common.tools.imageToVideo.name' },
];

export interface ToolTabsProps {
  /** `grid`: two by two in the side panel; `row`: one row of four (phones). */
  layout: 'grid' | 'row';
  className?: string;
}

/**
 * The four tools as tabs (arrow keys, Home and End move between them, in reading order). Must be
 * rendered inside `<Tabs>`, whose value is the selected tool.
 */
export function ToolTabs({ layout, className }: ToolTabsProps) {
  const { t } = useI18n();
  return (
    <TabsList
      aria-label={t('studio.toolsLabel')}
      className={cn(
        'w-full',
        layout === 'grid' ? 'grid grid-cols-2 gap-1' : 'grid grid-cols-4 gap-0.5 overflow-visible',
        className,
      )}
    >
      {TOOL_META.map(({ tool, icon: Icon, name }) => (
        <TabsTrigger
          key={tool}
          value={tool}
          className={cn(
            layout === 'grid'
              ? 'h-10 justify-start gap-2 px-3 text-start pointer-coarse:h-11'
              : 'h-14 flex-col gap-1 px-1 text-[0.6875rem] leading-tight whitespace-normal pointer-coarse:h-14',
          )}
        >
          <Icon aria-hidden="true" className={layout === 'grid' ? 'size-4' : 'size-5'} />
          <span className={cn(layout === 'grid' ? 'truncate' : 'text-center')}>{t(name)}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
