import { FlatCompat } from '@eslint/eslintrc'
import prettier from 'eslint-config-prettier'

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

/**
 * Several CLAUDE.md invariants are encoded as lint rules rather than left to
 * review. Each one below is a rule someone would otherwise break by accident in
 * a later phase — the comment says which invariant it protects.
 */

/** Arabic script — banned outside src/i18n (CLAUDE.md UI rules). */
const ARABIC_RANGE = '\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF'

/**
 * Physical CSS directions. Under RTL these silently land on the wrong side, and
 * the bug is invisible to anyone reading the code in English.
 */
const PHYSICAL_CLASS_RE =
  '(^|[\\\\s:])(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|float-left|float-right|text-left|text-right|origin-left|origin-right)(-|$|[\\\\s])'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  {
    rules: {
      // ── Correctness ──────────────────────────────────────────────────────
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // ── Import hygiene ───────────────────────────────────────────────────
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // ── Performance budget (SPEC §9: route JS < 180KB gzip) ──────────────
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'radix-ui',
              message:
                'Import the scoped package (@radix-ui/react-*) instead. The umbrella package adds ~77KB of client JS to every route that touches it. `shadcn add` generates the umbrella import — rewrite it.',
            },
          ],
        },
      ],

      // ── CLAUDE.md invariants ─────────────────────────────────────────────
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/[${ARABIC_RANGE}]/]`,
          message:
            'Arabic strings live in src/i18n/ar.ts. Import from there instead of inlining the literal.',
        },
        {
          selector: `TemplateElement[value.raw=/[${ARABIC_RANGE}]/]`,
          message:
            'Arabic strings live in src/i18n/ar.ts. Import from there instead of inlining the literal.',
        },
        {
          selector: `JSXText[value=/[${ARABIC_RANGE}]/]`,
          message:
            'Arabic strings live in src/i18n/ar.ts. Import from there instead of inlining the literal.',
        },
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=/${PHYSICAL_CLASS_RE}/]`,
          message:
            'Use logical properties (ms-/me-/ps-/pe-/start-/end-/border-s-/text-start) — physical directions break RTL.',
        },
        {
          selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${PHYSICAL_CLASS_RE}/]`,
          message:
            'Use logical properties (ms-/me-/ps-/pe-/start-/end-/border-s-/text-start) — physical directions break RTL.',
        },
      ],
    },
  },

  // ── Vendored shadcn components ─────────────────────────────────────────
  // Deliberately NOT ignored: the RTL rule above is exactly what must run over
  // anything pulled from the registry, since upstream is written for LTR.
  // Only the house formatting rules are relaxed.
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'import/order': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // ── src/i18n is the one place Arabic literals belong ────────────────────
  {
    files: ['src/i18n/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // ── lib/search normalises Arabic *characters*, not Arabic *copy* ────────
  // The rule above exists so that user-facing wording lives in one file and can
  // be changed in one place. A fold table (أ→ا, ة→ه) is neither user-facing nor
  // changeable copy: it is the alphabet. Writing it as \u escapes to satisfy the
  // rule would make the one file where a reviewer must actually see the letters
  // the one file where they cannot.
  {
    files: ['src/lib/search.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // ── Services must stay framework-free and unit-testable ────────────────
  {
    files: ['src/modules/*/service.ts', 'src/lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'server-only', 'react', 'react-dom'],
              message:
                'Services and lib/ must run under plain Vitest. Keep next/react imports in actions, queries and components.',
            },
          ],
        },
      ],
    },
  },
  {
    // lib/db and lib/scheduler legitimately touch the Node runtime, and the
    // rule above would otherwise fire on their Prisma/next-adjacent imports.
    files: ['src/lib/utils.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // ── Money must never be a float (CLAUDE.md invariant 2) ────────────────
  {
    files: ['src/modules/**/*.ts', 'src/lib/settings/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Money is Decimal. Use toMoney() from lib/money.',
        },
      ],
    },
  },

  // ── Tests: Arabic test names are required, not banned ──────────────────
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'prisma/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Prettier last: it disables every stylistic rule the formatter owns.
  prettier,
]

export default config
