module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/mcp-protocol-compliance.test.ts'], // Temporarily only run this test to isolate OOM issue
  // testMatch: ['**/*.test.ts'], // Original - uncomment to run all tests
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        moduleResolution: 'node',
        esModuleInterop: true,
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverage: false, // Disable coverage collection to save memory
  collectCoverageFrom: [
    'mcp_server/src/**/*.ts',
    '!**/*.d.ts',
  ],
  testTimeout: 30000, // 30 seconds for e2e tests
  // maxWorkers removed - using --runInBand in package.json instead
  silent: false, // Ensure Jest output is not suppressed
  verbose: true, // Enable verbose output (also set via CLI flag)
};

