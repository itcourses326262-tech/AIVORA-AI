import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

// The wrapper pins its own copy of axe-core; the component tests use the repository's, so the same
// engine (and so the same rules) judges both.
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

interface Finding {
  rule: string;
  impact: string;
  help: string;
  nodes: string[];
}

/**
 * Runs axe on the page as it is (real layout, real colours) and fails on any serious or critical
 * violation. Lesser findings are attached to the report, not failed on.
 */
export async function expectNoSeriousViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page, axeSource: AXE_SOURCE }).withTags(TAGS).analyze();
  const findings: Finding[] = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.help,
    nodes: violation.nodes
      .slice(0, 4)
      .map((node) => `${node.target.join(' ')} :: ${node.html.slice(0, 160)}`),
  }));
  const blocking = findings.filter(
    (finding) => finding.impact === 'serious' || finding.impact === 'critical',
  );
  const minor = findings.filter((finding) => !blocking.includes(finding));
  if (minor.length > 0) {
    await testInfo.attach(`axe-minor-${label}`, {
      body: JSON.stringify(minor, null, 2),
      contentType: 'application/json',
    });
  }
  expect(blocking, `serious or critical axe violations on ${label}`).toEqual([]);
}
