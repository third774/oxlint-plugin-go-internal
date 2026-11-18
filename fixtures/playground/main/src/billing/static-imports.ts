// The forms that the README lists. Every one is expected to be reported.
import { rowCount } from '../teams/internal/rows'; // expect: internalImport
import type { Row } from '../teams/internal/rows'; // expect: internalImport
import '../teams/internal/rows'; // expect: internalImport
import { store } from '#/teams/internal/storage/store'; // expect: internalImport
import { query } from '@/teams/internal/storage/internal/sql'; // expect: internalImport
import legacy = require('../teams/internal/legacy.cjs'); // expect: internalImport
import { rowCount as publicCount } from '../teams/index';
export type Rows = typeof import('../teams/internal/rows'); // expect: internalImport
export const load = () => import('../teams/internal/rows'); // expect: internalImport
export const all = [rowCount, store, query, legacy, publicCount] as const;
export type R = Row;
