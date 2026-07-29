import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const typedRules = {
  ...js.configs.recommended.rules,
  ...typescriptEslint.configs.recommended.rules,
  ...prettier.rules,
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  'no-control-regex': 'off',
  'no-undef': 'off',
  'no-useless-escape': 'off',
};

const typedLanguageOptions = (project) => ({
  parser: typescriptParser,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project,
    tsconfigRootDir: import.meta.dirname,
  },
});

export default [
  {
    ignores: ['**/node_modules/**', 'dist/**', 'coverage/**', '.data/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...typedLanguageOptions('./tsconfig.json'),
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.vitest,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...typedRules,
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      ...typedLanguageOptions('./server/tsconfig.json'),
      globals: {
        ...globals.node,
        ...globals.es2022,
        ...globals.vitest,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },
    rules: typedRules,
  },
  {
    files: ['vite.config.ts'],
    languageOptions: {
      ...typedLanguageOptions('./tsconfig.node.json'),
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },
    rules: typedRules,
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...prettier.rules,
    },
  },
];
