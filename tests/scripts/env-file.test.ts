import { describe, expect, it } from 'vitest';
import { readEnvValue, upsertEnv } from '../../scripts/lib/env-file';

describe('upsertEnv with a name that appears more than once', () => {
  // dotenv, Next.js and Node's --env-file let the LAST assignment win, so updating only the first
  // line reports success while the site keeps the old value.
  it('updates every line of the name, so the value the site loads is the new one', () => {
    const before = '# my settings\nSTORAGE_DRIVER=local\nFAL_KEY=abc\n\nSTORAGE_DRIVER=local\n';
    const after = upsertEnv(before, { STORAGE_DRIVER: 'gcs' });
    expect(after).toBe('# my settings\nSTORAGE_DRIVER=gcs\nFAL_KEY=abc\n\nSTORAGE_DRIVER=gcs\n');
    expect(readEnvValue(after, 'STORAGE_DRIVER')).toBe('gcs');
  });

  it('keeps CRLF line endings while doing so', () => {
    const before = 'A=1\r\nB=2\r\nA=3\r\n';
    expect(upsertEnv(before, { A: 'x' })).toBe('A=x\r\nB=2\r\nA=x\r\n');
  });

  it('does not append a name that was found, and appends one that was not, once', () => {
    const out = upsertEnv('A=1\nA=2\n', { A: 'x', B: 'y' });
    expect(out).toBe('A=x\nA=x\nB=y\n');
  });

  it('leaves names that only share a prefix, comments and other lines alone', () => {
    const before = 'A=1\n# A=2\nAB=3\n  A = 4\n';
    expect(upsertEnv(before, { A: 'x' })).toBe('A=x\n# A=2\nAB=3\nA=x\n');
  });

  it('is not fooled by names that exist on every object', () => {
    expect(upsertEnv('constructor=1\n', { A: 'x' })).toBe('constructor=1\nA=x\n');
  });
});
