// Re-exports inside an ambient module declaration.
declare module 'teams-public' {
  export * from '../internal/rows'; // expect: internalReExport
  import { rowCount } from '../internal/rows';
  export { rowCount }; // expect: internalReExport
}
