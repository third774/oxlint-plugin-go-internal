import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTsconfigAliasResolver } from '../aliases.ts';

let root = '';
let time = 0;
const clock = (): number => time;

/** Writes a tsconfig with `paths: { '#/*': [target] }` and a modification time of `modifiedAt` seconds. */
const writeTsconfig = (directory: string, target: string, modifiedAt: number): string => {
  const file = path.join(directory, 'tsconfig.json');
  writeFileSync(file, JSON.stringify({ compilerOptions: { paths: { '#/*': [target] } } }));
  utimesSync(file, modifiedAt, modifiedAt);
  return file;
};

const directory = (...elements: string[]): string => {
  const result = path.join(root, ...elements);
  mkdirSync(result, { recursive: true });
  return result;
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'go-internal-aliases-'));
  time = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createTsconfigAliasResolver', () => {
  it('sees an edited tsconfig after the check interval', () => {
    const a = directory('a');
    writeTsconfig(root, './one/*', 1);
    const aliases = createTsconfigAliasResolver(clock);
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'one/x')] });

    writeTsconfig(root, './two/*', 2);
    time = 999;
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'one/x')] });
    time = 1000;
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'two/x')] });
  });

  it('sees an added tsconfig after the check interval', () => {
    const a = directory('a');
    const aliases = createTsconfigAliasResolver(clock);
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Unmatched', tsconfig: undefined });

    const tsconfig = writeTsconfig(a, './one/*', 1);
    time = 1000;
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'one/x')] });
    expect(aliases(a, 'package')).toStrictEqual({ _tag: 'Unmatched', tsconfig });
  });

  it('uses the tsconfig above a removed tsconfig after the check interval', () => {
    const a = directory('a');
    const b = directory('a', 'b');
    const outer = writeTsconfig(root, './outer/*', 1);
    writeTsconfig(a, './inner/*', 1);
    const aliases = createTsconfigAliasResolver(clock);
    expect(aliases(a, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });
    time = 500;
    expect(aliases(b, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });

    rmSync(path.join(a, 'tsconfig.json'));
    time = 999;
    expect(aliases(b, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });
    time = 1100;
    expect(aliases(b, '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'outer/x')] });
    expect(aliases(b, 'package')).toStrictEqual({ _tag: 'Unmatched', tsconfig: outer });
  });
});
