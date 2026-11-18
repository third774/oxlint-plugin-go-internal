import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject } from '../project.ts';

let root = '';
let time = 0;
const clock = (): number => time;

const writeJson = (file: string, json: unknown, modifiedAt = 1): string => {
  writeFileSync(file, JSON.stringify(json));
  utimesSync(file, modifiedAt, modifiedAt);
  return file;
};

/** Writes a tsconfig with `paths: { '#/*': [target] }` and a modification time of `modifiedAt` seconds. */
const writeTsconfig = (directory: string, target: string, modifiedAt: number): string =>
  writeJson(path.join(directory, 'tsconfig.json'), { compilerOptions: { paths: { '#/*': [target] } } }, modifiedAt);

const directory = (...elements: string[]): string => {
  const result = path.join(root, ...elements);
  mkdirSync(result, { recursive: true });
  return result;
};

/** A file in `directory`, for the lookups that start at a file. */
const fileIn = (inDirectory: string, name = 'x.ts'): string => path.join(inDirectory, name);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'go-internal-project-'));
  time = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createProject', () => {
  describe('paths', () => {
    it('sees an edited tsconfig after the check interval', () => {
      const a = directory('a');
      writeTsconfig(root, './one/*', 1);
      const { paths } = createProject(clock);
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'one/x')] });

      writeTsconfig(root, './two/*', 2);
      time = 999;
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'one/x')] });
      time = 1000;
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'two/x')] });
    });

    it('sees an added tsconfig after the check interval', () => {
      const a = directory('a');
      const { paths } = createProject(clock);
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Unmatched', config: undefined, baseUrl: undefined });

      const tsconfig = writeTsconfig(a, './one/*', 1);
      time = 1000;
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'one/x')] });
      expect(paths(fileIn(a), 'package')).toStrictEqual({ _tag: 'Unmatched', config: tsconfig, baseUrl: undefined });
    });

    it('uses the tsconfig above a removed tsconfig after the check interval', () => {
      const a = directory('a');
      const b = directory('a', 'b');
      const outer = writeTsconfig(root, './outer/*', 1);
      writeTsconfig(a, './inner/*', 1);
      const { paths } = createProject(clock);
      expect(paths(fileIn(a), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });
      time = 500;
      expect(paths(fileIn(b), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });

      rmSync(path.join(a, 'tsconfig.json'));
      time = 999;
      expect(paths(fileIn(b), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'inner/x')] });
      time = 1100;
      expect(paths(fileIn(b), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(root, 'outer/x')] });
      expect(paths(fileIn(b), 'package')).toStrictEqual({ _tag: 'Unmatched', config: outer, baseUrl: undefined });
    });

    it('reads a jsconfig.json, and prefers a tsconfig.json in the same directory', () => {
      const a = directory('a');
      writeJson(path.join(a, 'jsconfig.json'), { compilerOptions: { paths: { '#/*': ['./js/*'] } } });
      writeTsconfig(root, './ts/*', 1);
      expect(createProject(clock).paths(fileIn(a, 'x.js'), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'js/x')] });

      writeTsconfig(a, './ts/*', 1);
      expect(createProject(clock).paths(fileIn(a, 'x.js'), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(a, 'ts/x')] });
    });

    it('uses the referenced config that selects the file, as for a solution tsconfig', () => {
      const src = directory('src');
      const test = directory('test');
      writeJson(path.join(root, 'tsconfig.json'), { files: [], references: [{ path: './tsconfig.app.json' }, { path: './tests' }] });
      writeJson(path.join(root, 'tsconfig.app.json'), { compilerOptions: { paths: { '#/*': ['./src/*'] } }, include: ['src'] });
      const tests = directory('tests');
      writeJson(path.join(tests, 'tsconfig.json'), { compilerOptions: { paths: { '#/*': ['../test/*'] } }, include: ['../test'] });
      const { paths } = createProject(clock);

      expect(paths(fileIn(src), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(src, 'x')] });
      expect(paths(fileIn(src, 'Component.vue'), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(src, 'x')] });
      expect(paths(fileIn(test), '#/x')).toStrictEqual({ _tag: 'Matched', targets: [path.join(test, 'x')] });
      expect(paths(fileIn(root, 'vite.config.ts'), '#/x')).toStrictEqual({
        _tag: 'Unmatched',
        config: path.join(root, 'tsconfig.json'),
        baseUrl: undefined,
      });
    });

    it('gives the absolute baseUrl of an unmatched specifier', () => {
      const tsconfig = writeJson(path.join(root, 'tsconfig.json'), { compilerOptions: { baseUrl: './src' } });
      expect(createProject(clock).paths(fileIn(root), 'teams/x')).toStrictEqual({
        _tag: 'Unmatched',
        config: tsconfig,
        baseUrl: path.join(root, 'src'),
      });
    });
  });

  describe('packageScope', () => {
    it('reads the name and the imports of the nearest package.json', () => {
      const a = directory('a', 'b');
      const packageJson = writeJson(path.join(root, 'a', 'package.json'), { name: 'a', imports: { '#x': './x.js', '/bad': './y.js' } });
      writeJson(path.join(root, 'package.json'), { name: 'root' });

      const scope = createProject(clock).packageScope(a);
      expect(scope).toStrictEqual({
        path: packageJson,
        directory: path.join(root, 'a'),
        name: 'a',
        imports: new Map([['#x', './x.js']]),
        modifiedAt: 1000,
      });
    });

    it('reads a package.json that is not valid JSON as one with no fields', () => {
      writeFileSync(path.join(root, 'package.json'), '{');
      expect(createProject(clock).packageScope(root)).toMatchObject({ name: undefined, imports: new Map() });
    });
  });
});
