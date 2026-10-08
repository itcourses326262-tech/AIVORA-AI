import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Files whose default export is required by Next.js, the test runners or the message dictionaries.
const defaultExportAllowed = [
  '*.config.{ts,mjs}',
  'src/app/**/{page,layout,template,default,loading,error,global-error,not-found,forbidden,unauthorized}.tsx',
  'src/app/**/{sitemap,robots,manifest,icon,apple-icon,opengraph-image,twitter-image}.{ts,tsx}',
  'src/lib/i18n/messages/*.ts',
  'src/types/**/*.d.ts',
];

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'out/**',
    'drizzle/**',
    'node_modules/**',
    'coverage/**',
    'data/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'import/no-default-export': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'gifenc',
              message:
                "Import from '@/lib/gifenc' instead: gifenc's module shape differs per runtime.",
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/lib/gifenc.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: defaultExportAllowed,
    rules: { 'import/no-default-export': 'off' },
  },
]);
