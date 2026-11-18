// Re-export everything from an internal module. A user expects every form to be reported.
export * from '../internal/rows'; // expect: internalModuleReExport
export * as rows from '../internal/rows'; // expect: internalModuleReExport
export type * from '../internal/rows'; // expect: internalModuleReExport
export type * as RowTypes from '../internal/rows'; // expect: internalModuleReExport
export * from '#/teams/internal/rows'; // expect: internalModuleReExport
export * from '@/teams/internal/index'; // expect: internalModuleReExport
