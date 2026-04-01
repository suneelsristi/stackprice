// @ts-check
const path = require('path');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  tsPlugin.configs['flat/eslint-recommended'],
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: path.resolve(__dirname, 'tsconfig.test.json'),
        tsconfigRootDir: __dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'off',
    },
  },
];
