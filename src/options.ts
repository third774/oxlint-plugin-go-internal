import type { Options, RuleOptionsSchema } from '@oxlint/plugins';

/** Test-runner calls that load a module by path, named as `object.method`. */
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
];

export interface RuleOptions {
  readonly moduleCallees: ReadonlySet<string>;
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
    },
    additionalProperties: false,
  },
];

export const parseOptions = (options: Readonly<Options>): RuleOptions => {
  const [first] = options;
  const callees = typeof first === 'object' && first !== null && !Array.isArray(first) ? first['moduleCallees'] : undefined;
  return {
    moduleCallees: new Set(Array.isArray(callees) ? callees.filter((callee) => typeof callee === 'string') : DEFAULT_MODULE_CALLEES),
  };
};
