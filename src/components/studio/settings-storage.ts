/**
 * The last-used settings of each tool, kept in `localStorage`. Storage can be missing or throw
 * (private windows, blocked site data), so every access is guarded and the studio works without it.
 * What comes back is checked field by field: it is data from disk, not from our code.
 */
import { ASPECT_RATIOS, RESOLUTIONS, TOOLS, type Tool } from '@/lib/catalog/types';
import { isRecord } from '@/lib/utils';
import type { ToolSettings } from './form';

const STORAGE_KEY = 'aivore.studio.v1';

export interface StoredStudio {
  tool: Tool | null;
  tools: Partial<Record<Tool, ToolSettings>>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function readSettings(value: unknown): ToolSettings | null {
  if (!isRecord(value)) return null;
  const { modelId, strength } = value;
  return {
    modelId:
      typeof modelId === 'string' && modelId.length > 0 && modelId.length <= 100 ? modelId : null,
    aspectRatio: oneOf(value.aspectRatio, ASPECT_RATIOS),
    count: wholeNumber(value.count, 1, 8),
    durationSec: wholeNumber(value.durationSec, 1, 120),
    resolution: oneOf(value.resolution, RESOLUTIONS),
    strength: typeof strength === 'number' && strength >= 0 && strength <= 1 ? strength : null,
  };
}

export function loadStudioSettings(): StoredStudio | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    const tools: StoredStudio['tools'] = {};
    for (const tool of TOOLS) {
      const settings = isRecord(data.tools) ? readSettings(data.tools[tool]) : null;
      if (settings) tools[tool] = settings;
    }
    return { tool: oneOf(data.tool, TOOLS), tools };
  } catch {
    return null;
  }
}

export function saveStudioSettings(
  tool: Tool,
  current: ToolSettings,
  others: Partial<Record<Tool, ToolSettings>>,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tool, tools: { ...others, [tool]: current } }),
    );
  } catch {
    // Nothing to do: the settings simply are not remembered.
  }
}
