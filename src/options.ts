import type { Options, RuleOptionsSchema } from '@oxlint/plugins';

/** Test-runner calls that load or replace a module by path, named as `object.method`. */
export const DEFAULT_MODULE_CALLEES: readonly string[] = [
  'vi.mock',
  'vi.doMock',
  'vi.unmock',
  'vi.doUnmock',
  'vi.importActual',
  'vi.importMock',
  'jest.mock',
  'jest.doMock',
  'jest.unmock',
  'jest.requireActual',
  'jest.requireMock',
  'jest.unstable_mockModule',
  'jest.createMockFromModule',
  'jest.setMock',
  'mock.module',
];

/** Prefixes of aliases that are never package names, other than `#`. */
export const DEFAULT_ALIAS_PREFIXES: readonly string[] = ['@/', '~/'];

export interface RuleOptions {
  readonly moduleCallees: ReadonlySet<string>;
  readonly aliasPrefixes: readonly string[];
  readonly allowedPackages: ReadonlySet<string>;
}

export const optionsSchema: RuleOptionsSchema = [
  {
    type: 'object',
    properties: {
      moduleCallees: {
        description: 'Calls whose first argument is a module specifier, such as `vi.mock`. Replaces the default list.',
        type: 'array',
        items: { type: 'string' },
        uniqueItems: true,
      },
      aliasPrefixes: {
        description:
          'Prefixes of specifiers that must match a tsconfig `paths` entry, such as `@/`. Specifiers that start with `#` always must. Replaces the default list.',
        type: 'array',
        items: { type: 'string', minLength: 1 },
        uniqueItems: true,
      },
      allowedPackages: {
        description: 'Packages whose `internal` paths any file can import, such as `svelte`.',
        type: 'array',
        items: { type: 'string', minLength: 1 },
        uniqueItems: true,
      },
    },
    additionalProperties: false,
  },
];

const DEFAULT_OPTIONS: RuleOptions = {
  moduleCallees: new Set(DEFAULT_MODULE_CALLEES),
  aliasPrefixes: DEFAULT_ALIAS_PREFIXES,
  allowedPackages: new Set(),
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string' && item !== '') : undefined;

export const parseOptions = (options: Readonly<Options>): RuleOptions => {
  const [first] = options;
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    return DEFAULT_OPTIONS;
  }
  const callees = strings(first['moduleCallees']);
  const aliasPrefixes = strings(first['aliasPrefixes']);
  const allowedPackages = strings(first['allowedPackages']);
  return {
    moduleCallees: callees === undefined ? DEFAULT_OPTIONS.moduleCallees : new Set(callees),
    aliasPrefixes: aliasPrefixes ?? DEFAULT_OPTIONS.aliasPrefixes,
    allowedPackages: allowedPackages === undefined ? DEFAULT_OPTIONS.allowedPackages : new Set(allowedPackages),
  };
};
