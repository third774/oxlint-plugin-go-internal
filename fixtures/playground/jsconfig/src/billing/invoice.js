import { rowCount } from '@/teams/internal/rows'; // expect: internalImport
import { rowCount as other } from '#/teams/internal/rows'; // expect: internalImport
export const count = rowCount + other;
