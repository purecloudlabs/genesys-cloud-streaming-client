/* istanbul ignore file */
if (!global) {
  Object.defineProperty(window, 'crypto', { value: window.crypto || window.msCrypto, writable: false, configurable: false });
}
