/**
 * Makes `require('vscode')` resolvable, and returns the fake it resolves to.
 *
 * The `vscode` module is injected by the extension host and exists nowhere on
 * disk, which is what kept extension/index.js — the whole activate() closure —
 * out of the test suite. Vite's resolve.alias does not help: these test files
 * run as real CommonJS through Node's loader, which never consults it. So teach
 * Node's resolver about the one specifier instead.
 *
 * Requiring this module is the whole setup; anything loaded afterwards (the
 * extension included) gets the fake in __mocks__/vscode.js.
 */

const Module = require('module');
const path = require('path');

const MOCK = require.resolve(path.join(__dirname, '..', '..', '__mocks__', 'vscode.js'));

if (!Module._resolveFilename.__vscodeStubbed) {
  const original = Module._resolveFilename;
  const patched = function (request, ...rest) {
    return request === 'vscode' ? MOCK : original.call(this, request, ...rest);
  };
  patched.__vscodeStubbed = true;
  Module._resolveFilename = patched;
}

module.exports = require(MOCK);
