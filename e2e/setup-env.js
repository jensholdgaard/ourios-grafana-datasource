// The @grafana/data barrel touches window/document/localStorage at import
// time (its Store and theme machinery), so give the node environment just
// enough browser shape to import it. Node's own fetch does the networking —
// no jsdom, no polyfilled fetch, no hangs.
const element = () => ({
  style: {},
  setAttribute: () => {},
  appendChild: () => {},
  insertBefore: () => {},
  sheet: { insertRule: () => {}, cssRules: [] },
});
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  createElement: element,
  head: { appendChild: () => {}, insertBefore: () => {} },
  getElementsByTagName: () => [element()],
  querySelector: () => null,
  addEventListener: () => {},
};
globalThis.navigator = { userAgent: 'node' };
globalThis.history = { pushState: () => {}, replaceState: () => {}, state: null };
globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '' };
