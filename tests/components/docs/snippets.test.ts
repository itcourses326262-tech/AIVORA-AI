import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUICKSTART_LANGUAGE,
  HIGHLIGHT_AS,
  QUICKSTART_LANGUAGES,
  QUICKSTART_STEPS,
  isQuickstartLanguage,
  quickstartCode,
} from '@/components/docs/snippets';

const INPUT = {
  origin: 'https://aivore.example',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at "dawn", soft fog',
  aspectRatio: '16:9',
};
const code = quickstartCode(INPUT);
const script = (language: (typeof QUICKSTART_LANGUAGES)[number]) =>
  `${QUICKSTART_STEPS.map((step) => code[step][language]).join('\n\n')}\n`;

describe('quickstartCode', () => {
  it('has every step in every language', () => {
    for (const step of QUICKSTART_STEPS) {
      for (const language of QUICKSTART_LANGUAGES) {
        expect(code[step][language].length, `${step} ${language}`).toBeGreaterThan(40);
      }
    }
  });

  it('uses this deployment, the chosen model and the real endpoints', () => {
    for (const language of QUICKSTART_LANGUAGES) {
      const all = script(language);
      expect(all).toContain('https://aivore.example');
      expect(all).toContain('aivore-demo-image');
      expect(all).toContain('16:9');
      expect(all).toContain('/generations');
      expect(all).toContain('Idempotency-Key');
      expect(all).toContain('AIVORE_API_KEY');
    }
  });

  it('puts the prompt in as a properly quoted string', () => {
    expect(script('javascript')).toContain('prompt: "A lighthouse at \\"dawn\\", soft fog"');
    expect(script('python')).toContain('"prompt": "A lighthouse at \\"dawn\\", soft fog"');
    expect(script('bash')).toContain('"prompt": "A lighthouse at \\"dawn\\", soft fog"');
  });

  it('never ends a polling loop only on success: failure and cancel stop it too', () => {
    expect(code.poll.javascript).toContain('"failed"');
    expect(code.poll.javascript).toContain('"canceled"');
    expect(code.poll.python).toContain('"failed"');
    expect(code.poll.bash).toContain('queued|processing');
  });

  it('is syntactically valid JavaScript', () => {
    const result = ts.transpileModule(script('javascript'), {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: 'quickstart.mjs',
    });
    expect(
      result.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    ).toEqual([]);
  });

  it('is syntactically valid shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aivore-qs-'));
    try {
      const file = join(dir, 'quickstart.sh');
      writeFileSync(file, script('bash'));
      expect(() => execFileSync('bash', ['-n', file], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the setup step to the key and the base URL', () => {
    expect(code.setup.bash).toContain('export AIVORE_API_KEY=');
    expect(code.setup.javascript).toContain('process.env.AIVORE_API_KEY');
    expect(code.setup.python).toContain("os.environ['AIVORE_API_KEY']");
  });

  it('is highlighted with the matching tokenizer', () => {
    expect(HIGHLIGHT_AS).toEqual({ bash: 'bash', javascript: 'javascript', python: 'python' });
  });
});

describe('the quickstart languages', () => {
  it('accepts exactly the quickstart languages', () => {
    for (const language of QUICKSTART_LANGUAGES) expect(isQuickstartLanguage(language)).toBe(true);
    expect(isQuickstartLanguage('ruby')).toBe(false);
    expect(isQuickstartLanguage(undefined)).toBe(false);
  });

  it('starts with cURL', () => {
    expect(DEFAULT_QUICKSTART_LANGUAGE).toBe('bash');
  });
});
