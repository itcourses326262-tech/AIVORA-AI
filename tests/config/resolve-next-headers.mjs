// Child process of next-config-headers.test.ts. Loads the real next.config.ts the way `next build`
// does and answers, for each path given as JSON in argv[2], which response headers Next.js would
// put on it. The matching is Next's own (`getPathMatch`, built with the options its file system
// checker uses) and the rules are applied the way its router applies them: in order, a later rule
// replacing the value of an earlier one with the same key.
import { createRequire } from 'node:module';

const root = process.argv[3];
const require = createRequire(`${root}/`);
const loadConfig = require('next/dist/server/config').default;
const loadCustomRoutes = require('next/dist/lib/load-custom-routes').default;
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match');
const { modifyRouteRegex } = require('next/dist/lib/redirect-status');
const { PHASE_PRODUCTION_BUILD } = require('next/constants');

process.chdir(root);
const config = await loadConfig(PHASE_PRODUCTION_BUILD, root);
const { headers: rules } = await loadCustomRoutes(config);

for (const rule of rules) {
  if (rule.has || rule.missing)
    throw new Error(`rule ${rule.source} uses has/missing: not modelled`);
}

const paths = JSON.parse(process.argv[2]);
const result = {};
for (const path of paths) {
  const effective = {};
  const matched = [];
  for (const rule of rules) {
    const match = getPathMatch(rule.source, {
      strict: true,
      removeUnnamedParams: true,
      // As in Next's file system checker: a trailing slash is optional for a header rule.
      regexModifier: (regex) => modifyRouteRegex(regex, undefined),
      sensitive: false,
    });
    if (match(path) === false) continue;
    matched.push(rule.source);
    for (const { key, value } of rule.headers) effective[key] = value;
  }
  result[path] = { matched, headers: effective };
}
process.stdout.write(JSON.stringify({ sources: rules.map((rule) => rule.source), result }));
