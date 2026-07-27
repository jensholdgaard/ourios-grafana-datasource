// The e2e suites exercise the wire contract and the pure mapping — never
// Grafana's data proxy. src/datasource.ts imports these two names at module
// scope, so give it a stub that fails loudly if a suite ever strays into
// proxy territory.
module.exports = {
  getBackendSrv: () => {
    throw new Error('the data proxy is not under e2e test — use fetch against the fixture servers');
  },
  isFetchError: () => false,
};
