// The public API of teams/. It is allowed to import teams/internal/*.
import { rowCount as internalRowCount } from './internal/rows';
export const rowCount = internalRowCount;
