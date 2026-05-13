"use strict";
/* istanbul ignore file */
if (!global) {
    // @ts-ignore
    Object.defineProperty(window, 'crypto', { value: window.crypto || window.msCrypto, writable: false, configurable: false });
}
