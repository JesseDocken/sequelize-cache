import { defineConfig } from 'eslint/config';
import jsPlugin from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importPlugin from 'eslint-plugin-import-x';
import tsPlugin from 'typescript-eslint';
import nodePlugin from 'eslint-plugin-n';
import lintStylePlugin from '@stylistic/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import _ from 'lodash';

export default defineConfig([
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.vscode', 'eslint.config.ts', 'vitest.config.ts'],
  },
  importPlugin.flatConfigs.recommended as any,
  importPlugin.flatConfigs.typescript as any,
  nodePlugin.configs['flat/recommended'],
  {
    // All source code
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
        globals: {
          ...globals.node,
        },
      },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: import.meta.dirname,
        }),
      ],
    },
    plugins: {
      js: jsPlugin,
      '@stylistic': lintStylePlugin,
      '@typescript-eslint': tsPlugin.plugin,
    },
    extends: [jsPlugin.configs.recommended, tsPlugin.configs.recommendedTypeChecked],
    rules: {
      'default-param-last': 'off',
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-global-assign': 'off',
      'no-shadow': 'off',
      'no-loss-of-precision': 'warn',
      'no-unused-vars': 'off',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'warn',
      'prefer-exponentiation-operator': 'error',
      'prefer-numeric-literals': 'off',
      'prefer-object-has-own': 'warn',
      'prefer-object-spread': 'warn',
      'prefer-regex-literals': 'warn',
      'prefer-spread': 'error',
      strict: 'error',
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
      'n/no-unpublished-import': 'off',
      '@stylistic/eol-last': 'error',
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
      'import-x/first': 'error',
      'import-x/newline-after-import': ['error', { considerComments: true, exactCount: true }],
      'import-x/no-commonjs': 'error',
      'import-x/no-deprecated': 'off',
      'import-x/no-empty-named-blocks': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-import-module-exports': 'error',
      'import-x/order': [
        'warn',
        {
          groups: ['external', ['internal', 'sibling', 'parent'], 'type', 'object'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
          named: {
            enabled: true,
            export: false,
            types: 'types-last',
          },
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/promise-function-async': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
    },
  },
  {
    // Module augmentation files - generic signatures must match the original declarations
    files: ['sequelize-cached-model.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Test files - relax strict type checking rules
    files: ['unit/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
]);
