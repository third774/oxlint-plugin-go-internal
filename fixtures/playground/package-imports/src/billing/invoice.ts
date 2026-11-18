import { rowCount } from '#/teams/internal/rows.ts'; // expect: internalImport
import { rowCount as publicCount } from '#/teams/index.ts';
export const count = rowCount + publicCount;
