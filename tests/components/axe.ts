import axe from 'axe-core';

/**
 * Runs axe-core on `node` and returns one line per violation (`id (impact): selectors`), so a
 * failing assertion says what is wrong. jsdom has no layout: the colour-contrast rule cannot run
 * (contrast is covered by `tokens.test.ts`), and page-level landmark rules do not apply to a
 * component. `label-content-name-mismatch` is experimental in axe and switched on here.
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const results = await axe.run(node, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      'label-content-name-mismatch': { enabled: true },
    },
  });
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}
