import { fixupConfigRules } from '@eslint/compat';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

const eslintConfig = defineConfig([
  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },

  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),

  {
    files: ['**/*.{js,jsx,ts,tsx}'],

    settings: {
      react: {
        version: 'detect',
      },
    },

    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },

    rules: {
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',
      'react/no-danger': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'Do not use eval().',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'Do not use the Function constructor.',
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(SECRET|TOKEN|PRIVATE|PASSWORD|JWT|KEY).*$/]",
          message:
            'Do not expose secret-like values through NEXT_PUBLIC_* env vars. NEXT_PUBLIC_* is shipped to the browser.',
        },
      ],
    },
  },

  globalIgnores([
    '**/node_modules/**',
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    '*.config.js',
    '*.config.cjs',
  ]),
]);

export default eslintConfig;
