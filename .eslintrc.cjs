/** ESLint config for opencue (TypeScript + React + Electron). */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    // React 17+ JSX transform — no need to import React.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',

    // TypeScript strictness — surfaces real bugs.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    '@typescript-eslint/no-floating-promises': 'off',

    // Renderer must never use Node directly — only via the preload bridge.
    // (Per-file overrides below enforce this in renderer.)
    'no-restricted-imports': 'off',

    // Misc.
    eqeqeq: ['error', 'always'],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Renderer: forbid Node / Electron imports — must go through preload bridge.
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'electron', message: 'Renderer must not import electron directly — use the preload bridge.' },
              { name: 'fs', message: 'Renderer has no file-system access — use the preload bridge.' },
              { name: 'path', message: 'Renderer must not import node:path — use the preload bridge.' },
              { name: 'child_process', message: 'Renderer cannot spawn processes — use the preload bridge.' },
            ],
            patterns: ['node:*'],
          },
        ],
      },
    },
    {
      // Tests and config files can be looser.
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.config.{ts,js,cjs,mjs}'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'out',
    'dist',
    'release',
    'coverage',
    '*.min.js',
    'sidecar',
  ],
};
