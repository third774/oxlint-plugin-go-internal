// Test-runner calls that load or replace a module by path.
import { vi as v } from 'vitest';
import { jest } from '@jest/globals';
import { mock } from 'node:test';

vi.mock('../teams/internal/rows'); // expect: internalImport
vi.mock(import('../teams/internal/rows')); // expect: internalImport
await vi.importActual('../teams/internal/rows'); // expect: internalImport
jest.mock('../teams/internal/rows'); // expect: internalImport
jest.requireActual('../teams/internal/rows'); // expect: internalImport
v.mock('../teams/internal/rows'); // expect: internalImport
jest.unstable_mockModule('../teams/internal/rows', () => ({})); // expect: internalImport
jest.createMockFromModule('../teams/internal/rows'); // expect: internalImport
jest.setMock('../teams/internal/rows', {}); // expect: internalImport
mock.module('../teams/internal/rows', {}); // expect: internalImport
