import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolSettings } from '@/components/studio/form';
import { loadStudioSettings, saveStudioSettings } from '@/components/studio/settings-storage';

const KEY = 'aivore.studio.v1';

const settings = (overrides: Partial<ToolSettings> = {}): ToolSettings => ({
  modelId: 'aivore-demo-image',
  aspectRatio: '16:9',
  count: 2,
  durationSec: null,
  resolution: null,
  strength: 0.4,
  ...overrides,
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('studio settings storage', () => {
  it('has nothing the first time', () => {
    expect(loadStudioSettings()).toBeNull();
  });

  it('keeps the last tool and the settings of every tool', () => {
    saveStudioSettings('text-to-video', settings({ durationSec: 5, resolution: '720p' }), {
      'text-to-image': settings(),
    });
    expect(loadStudioSettings()).toEqual({
      tool: 'text-to-video',
      tools: {
        'text-to-image': settings(),
        'text-to-video': settings({ durationSec: 5, resolution: '720p' }),
      },
    });
  });

  it('never stores the prompt, the seed or the share switch', () => {
    saveStudioSettings('text-to-image', settings(), {});
    const raw = window.localStorage.getItem(KEY) ?? '';
    for (const word of ['prompt', 'seed', 'isPublic', 'negative']) expect(raw).not.toContain(word);
  });

  it('checks every field it reads back: unknown values become "not set"', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        tool: 'text-to-sound',
        tools: {
          'text-to-image': {
            modelId: 7,
            aspectRatio: '7:7',
            count: 99,
            durationSec: 1.5,
            resolution: '4k',
            strength: 3,
          },
          'not-a-tool': settings(),
          'text-to-video': 'garbage',
        },
      }),
    );
    expect(loadStudioSettings()).toEqual({
      tool: null,
      tools: {
        'text-to-image': {
          modelId: null,
          aspectRatio: null,
          count: null,
          durationSec: null,
          resolution: null,
          strength: null,
        },
      },
    });
  });

  it('survives broken JSON and values of the wrong shape', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect(loadStudioSettings()).toBeNull();
    window.localStorage.setItem(KEY, '[1,2,3]');
    expect(loadStudioSettings()).toBeNull();
    window.localStorage.setItem(KEY, '"text"');
    expect(loadStudioSettings()).toBeNull();
  });

  it('survives storage that is blocked: reading gives nothing, writing is silent', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(loadStudioSettings()).toBeNull();
    expect(() => saveStudioSettings('text-to-image', settings(), {})).not.toThrow();
  });

  it('survives a window without storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadStudioSettings()).toBeNull();
    expect(() => saveStudioSettings('text-to-image', settings(), {})).not.toThrow();
    vi.unstubAllGlobals();
  });
});
