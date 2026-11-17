import { statSync } from 'node:fs';
import path from 'node:path';

import { createPathsMatcher, findTsconfig, parseTsconfig } from 'get-tsconfig';
import type { PathsMatcher, TsConfigResult } from 'get-tsconfig';

/** The result of matching a non-relative specifier against tsconfig `paths`. */
export type AliasMatch =
  | { readonly _tag: 'Matched'; readonly targets: readonly [string, ...string[]] }
  | { readonly _tag: 'Unmatched'; readonly tsconfig: string | undefined };

/** Maps a non-relative specifier of a file in `importerDirectory` through its tsconfig `paths`. */
export type AliasResolver = (importerDirectory: string, specifier: string) => AliasMatch;

interface CachedTsconfig {
  readonly modifiedAt: number;
  readonly matcher: PathsMatcher | null;
}

/**
 * Only `paths` entries count as aliases. With `baseUrl` set, get-tsconfig also maps a specifier
 * that matches no entry to `baseUrl/specifier`, so the matcher is built from absolute targets
 * without `baseUrl`.
 */
const pathsMatcher = (tsconfig: TsConfigResult): PathsMatcher | null => {
  const { baseUrl, paths } = tsconfig.config.compilerOptions ?? {};
  if (paths === undefined) {
    return null;
  }
  if (baseUrl === undefined) {
    return createPathsMatcher(tsconfig);
  }
  const base = path.resolve(path.dirname(tsconfig.path), baseUrl);
  const absolutePaths = Object.fromEntries(
    Object.entries(paths).map(([pattern, targets]) => [pattern, targets.map((target) => path.resolve(base, target))]),
  );
  return createPathsMatcher({
    path: tsconfig.path,
    config: { compilerOptions: { paths: absolutePaths } },
  });
};

/**
 * Reads the nearest `tsconfig.json`, with `extends` applied. A parsed config is reused until its
 * modification time changes, so a long editor session sees edits to it.
 */
export const createTsconfigAliasResolver = (): AliasResolver => {
  const cache = new Map<string, CachedTsconfig>();

  const matcherFor = (tsconfigPath: string): PathsMatcher | null => {
    const modifiedAt = statSync(tsconfigPath).mtimeMs;
    const cached = cache.get(tsconfigPath);
    if (cached !== undefined && cached.modifiedAt === modifiedAt) {
      return cached.matcher;
    }
    const matcher = pathsMatcher({ path: tsconfigPath, config: parseTsconfig(tsconfigPath) });
    cache.set(tsconfigPath, { modifiedAt, matcher });
    return matcher;
  };

  return (importerDirectory, specifier) => {
    const tsconfig = findTsconfig(importerDirectory);
    if (tsconfig === undefined) {
      return { _tag: 'Unmatched', tsconfig: undefined };
    }
    const [first, ...rest] = matcherFor(tsconfig)?.(specifier) ?? [];
    if (first === undefined) {
      return { _tag: 'Unmatched', tsconfig };
    }
    return {
      _tag: 'Matched',
      targets: [path.resolve(first), ...rest.map((target) => path.resolve(target))],
    };
  };
};
