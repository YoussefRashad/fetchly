import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // .ai/ holds project-setup's vendored runtime (git-safe, the raw-Git hook); it must stay byte-identical to the skill.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '.superpowers/**',
      '.remember/**',
      '.e2e-real/**',
      'extension/dist/**',
      '.ai/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tests/fakes/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', setTimeout: 'readonly' } },
  },
  {
    // The opt-in real-app driver (npm run e2e:real): Node scripts, plus callbacks that run in the window.
    files: ['e2e/real/**/*.mjs', 'e2e/real/**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    files: ['e2e/real/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', globalThis: 'readonly' } },
  },
);
