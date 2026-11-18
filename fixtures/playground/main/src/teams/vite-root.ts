// Vite resolves a leading `/` from the project root, so these are teams/internal for Vite.
// This file is under teams/, so it may import them.
import '/src/teams/internal/rows';
export * from '/src/teams/internal/rows'; // expect: internalModuleReExport
