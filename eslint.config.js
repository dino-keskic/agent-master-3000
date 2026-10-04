import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-server', 'dist-desktop', 'release', 'node_modules', 'data', 'coverage', 'scratch', '.claude']
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Config files and the plain-JS test fixture live outside tsconfig, so typed
  // rules have no program for them.
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly' } }
  },

  // The bin, the build script and the package smoke test run on Node 22+,
  // which has these as globals.
  {
    files: ['bin/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly'
      }
    }
  },

  // The notification service worker runs in a ServiceWorkerGlobalScope, where
  // `self` is the registration — not a browser window and not Node.
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { self: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] }
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      // projectService replaces the hand-maintained `project` array and picks up
      // every file covered by tsconfig.json, tests included.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // The rules that pay for type-aware linting: unhandled async work is this
      // codebase's main failure mode.
      '@typescript-eslint/no-floating-promises': 'error',
      // React event handlers may return a promise; React ignores it. Everything
      // else (a promise where a void callback is required) stays an error.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // `any` is now the exception, not the default. What arrives from ACP is
      // parsed by the zod schemas in server/acp/schema.ts instead.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true, allowBoolean: true }],

      'no-console': 'off'
    }
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Prop-sync effects have been converted to render-time adjustment. What
      // remains are mount-time data fetches and one debounce timer, where the
      // rule's real answer is a data-fetching library (TanStack Query) rather
      // than a local rewrite. Kept visible as warnings until that lands.
      'react-hooks/set-state-in-effect': 'warn',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },

  // Tests assert on partial fixtures; the strictest inference rules get noisy
  // there without catching anything real.
  {
    files: ['tests/**/*.ts', 'sandbox/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-floating-promises': 'off'
    }
  }
);
