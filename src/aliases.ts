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
  readonly checkedAt: number;
}

/** A cached `findTsconfig` result for a directory; `null` is a directory with no tsconfig above it. */
interface CachedNearest {
  readonly tsconfig: string | null;
  readonly checkedAt: number;
}

/**
 * How long a cached tsconfig lookup trusts its result before it checks the filesystem again.
 * The answer is stable for a whole lint run, so a walk and a stat per import buy nothing; this
 * keeps a long editor session able to see a tsconfig that is edited, added or removed.
 */
const CHECK_INTERVAL_MS = 1000;

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
  const nearest = new Map<string, CachedNearest>();
  const cache = new Map<string, CachedTsconfig>();

  const nearestTsconfig = (importerDirectory: string): string | undefined => {
    const now = Date.now();
    const cached = nearest.get(importerDirectory);
    if (cached !== undefined && now - cached.checkedAt < CHECK_INTERVAL_MS) {
      return cached.tsconfig ?? undefined;
    }
    const tsconfig = findTsconfig(importerDirectory) ?? null;
    nearest.set(importerDirectory, { tsconfig, checkedAt: now });
    return tsconfig ?? undefined;
  };

  const matcherFor = (tsconfigPath: string): PathsMatcher | null => {
    const now = Date.now();
    const cached = cache.get(tsconfigPath);
    if (cached !== undefined && now - cached.checkedAt < CHECK_INTERVAL_MS) {
      return cached.matcher;
    }
    const modifiedAt = statSync(tsconfigPath).mtimeMs;
    if (cached !== undefined && cached.modifiedAt === modifiedAt) {
      cache.set(tsconfigPath, { ...cached, checkedAt: now });
      return cached.matcher;
    }
    const matcher = pathsMatcher({ path: tsconfigPath, config: parseTsconfig(tsconfigPath) });
    cache.set(tsconfigPath, { matcher, modifiedAt, checkedAt: now });
    return matcher;
  };

  return (importerDirectory, specifier) => {
    const tsconfig = nearestTsconfig(importerDirectory);
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
