/** Lint gate: TypeScript does the type checks; these rules catch what it does not. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  env: { browser: true, es2022: true },
  rules: {
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // The CSP has no 'unsafe-eval' and the pages no inline script: keep it that way.
    'no-eval': 'error',
    'no-implied-eval': 'error',
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
