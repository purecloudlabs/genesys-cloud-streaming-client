/*
 * Integration-test jest config. Runs only test/integration, with no coverage,
 * and writes its junit to test-results/integration/ so CI can report IT results
 * separately from unit results. Everything else inherits from the base.
 */
const base = require('./jest.config');

module.exports = {
  ...base,
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['<rootDir>/test/integration/**/*.it.test.ts'],
  collectCoverage: false,
  coverageThreshold: undefined,
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'test-results/integration',
      outputName: 'test-results.xml'
    }]
  ]
};
