'use client';

import { Heart, Search, X } from 'lucide-react';
import { GENERATION_STATUSES } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Input } from '../ui/input';
import { SegmentedControl } from '../ui/radio-group';
import { Select } from '../ui/select';
import { MAX_SEARCH_CHARS, isFiltered, type KindFilter, type StatusFilter } from './filters';
import type { GalleryFilterControls } from './use-gallery-filters';

const KINDS: readonly KindFilter[] = ['all', 'image', 'video'];

function isKindFilter(value: string): value is KindFilter {
  return (KINDS as readonly string[]).includes(value);
}

function isStatusFilter(value: string): value is StatusFilter {
  return value === 'all' || (GENERATION_STATUSES as readonly string[]).includes(value);
}

export interface ToolbarProps {
  controls: GalleryFilterControls;
  className?: string;
}

/** Search, type, status and favorites: every change reloads the list from its first page. */
export function Toolbar({ controls, className }: ToolbarProps) {
  const { t } = useI18n();
  const { applied, searchText } = controls;

  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-center', className)}>
      <form
        role="search"
        aria-label={t('gallery.list.search.label')}
        onSubmit={(event) => {
          event.preventDefault();
          controls.submitSearch();
        }}
        className="min-w-0 lg:max-w-md lg:flex-1"
      >
        <Input
          dir="auto"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          maxLength={MAX_SEARCH_CHARS}
          aria-label={t('gallery.list.search.label')}
          placeholder={t('gallery.list.search.placeholder')}
          value={searchText}
          onChange={(event) => controls.setSearchText(event.target.value)}
          startAdornment={<Search aria-hidden="true" />}
          endAdornment={
            searchText === '' ? null : (
              <IconButton
                label={t('gallery.list.search.clear')}
                size="sm"
                tooltip={false}
                className="-me-1.5"
                onClick={() => {
                  controls.setSearchText('');
                  controls.submitSearch();
                }}
              >
                <X />
              </IconButton>
            )
          }
        />
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={t('gallery.list.filters.kind.label')}
          value={applied.kind}
          onValueChange={(value) => {
            if (isKindFilter(value)) controls.setKind(value);
          }}
          options={KINDS.map((value) => ({
            value,
            label: t(`gallery.list.filters.kind.${value}`),
          }))}
        />
        <Select
          aria-label={t('gallery.list.filters.status.label')}
          value={applied.status}
          onChange={(event) => {
            if (isStatusFilter(event.target.value)) controls.setStatus(event.target.value);
          }}
          boxClassName="w-auto min-w-36"
        >
          <option value="all">{t('gallery.list.filters.status.all')}</option>
          {GENERATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`studio.generations.status.${status}`)}
            </option>
          ))}
        </Select>
        <Button
          variant={applied.favorite ? 'secondary' : 'outline'}
          aria-pressed={applied.favorite}
          startIcon={<Heart className={cn(applied.favorite && 'fill-danger text-danger')} />}
          onClick={() => controls.setFavorite(!applied.favorite)}
        >
          {t('gallery.list.filters.favorites')}
        </Button>
        {isFiltered(applied) ? (
          <Button variant="ghost" onClick={controls.clearAll}>
            {t('gallery.list.filters.clear')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
