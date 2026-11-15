/** Compatibility export for existing deployment tooling. CAD no longer requires
 * a prototype database or separate project/model storage. */
export { assertCadConfiguration as assertCadPocIsolation } from './configuration.js';
