// Re-exports inside an ambient module declaration.
declare module 'teams-public' {
  export * from '../internal/rows'; // expect: internalModuleReExport
  import { rowCount } from '../internal/rows';
  export { rowCount }; // expect: internalReExport
}
