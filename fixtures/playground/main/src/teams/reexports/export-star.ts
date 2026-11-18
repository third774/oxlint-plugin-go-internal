// Re-export everything from an internal module. A user expects every form to be reported.
export * from '../internal/rows'; // expect: internalReExport
export * as rows from '../internal/rows'; // expect: internalReExport
export type * from '../internal/rows'; // expect: internalReExport
export type * as RowTypes from '../internal/rows'; // expect: internalReExport
export * from '#/teams/internal/rows'; // expect: internalReExport
export * from '@/teams/internal/index'; // expect: internalReExport
