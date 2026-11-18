/** Lint gate: TypeScript does the type checks; these rules catch what it does not. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  env: { node: true, es2022: true },
  rules: {
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // Identity is email + password only: never read Tailscale identity headers (docs/security.md).
    'no-restricted-syntax': ['error', {
      selector: "Literal[value=/^tailscale-user-|^tailscale-app-capabilities$/i]",
      message: 'Tailscale identity headers can be forged on the LAN; never read them.',
    }],
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
