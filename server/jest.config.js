module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  verbose: true,
  testTimeout: 30000, // 30 seconds global timeout
  setupFilesAfterEnv: ['./jest.setup.js']
};
