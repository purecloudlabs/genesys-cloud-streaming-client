module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'semistandard',
    'plugin:@typescript-eslint/recommended'
  ],
  plugins: ['@typescript-eslint'],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  ignorePatterns: [
    'src/**/*.js',
    'test/**/*.js',
    'dist/',
    'coverage/',
    'node_modules/'
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
    '@typescript-eslint/triple-slash-reference': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    'no-use-before-define': 'off',
    'no-proto': 'off',
    'no-void': 'off',
    'no-useless-constructor': 'off',
    'no-useless-return': 'off',
    'no-prototype-builtins': 'off',
    'no-mixed-operators': 'off',
    'import/first': 'off',
    'object-shorthand': 'warn',
    'quotes': ['error', 'single'],
    'prefer-const': 'error',
    'comma-dangle': ['error', 'never'],
    '@typescript-eslint/comma-dangle': ['error', 'never'],
    'padded-blocks': 'error',
    'dot-notation': 'error',
    'no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0 }],
    'indent': ['error', 2],
    'lines-between-class-members': 'error',
    'array-bracket-spacing': ['error', 'never']
  }
};