import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.superpowers/**', '.remember/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tests/fakes/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', setTimeout: 'readonly' } },
  },
);
