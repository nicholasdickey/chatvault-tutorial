module.exports = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
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
};

