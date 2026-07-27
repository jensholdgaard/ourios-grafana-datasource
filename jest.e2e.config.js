// The container e2e suites (e2e/run-e2e.sh orchestrates the fixture
// servers): node environment with a minimal browser shim (see
// setup-env.js) so @grafana/data imports, and the runtime mapped to a
// loud stub — the data proxy is Grafana's, not ours, and stays untested
// here. Node's native fetch does the networking.
const base = require('./jest.config');

module.exports = {
  ...base,
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/e2e/setup-env.js'],
  setupFilesAfterEnv: [],
  moduleNameMapper: {
    ...(base.moduleNameMapper ?? {}),
    '^@grafana/runtime$': '<rootDir>/e2e/grafana-runtime-stub.js',
  },
  testMatch: ['<rootDir>/e2e/**/*.e2e.test.{ts,tsx}'],
  testTimeout: 30000,
  passWithNoTests: false,
};
