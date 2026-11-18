import { statSync } from 'node:fs';
import path from 'node:path';

import { createPathsMatcher, findTsconfig, parseTsconfig } from 'get-tsconfig';
import type { Cache, PathsMatcher, TsConfigResult } from 'get-tsconfig';

/** The result of matching a non-relative specifier against tsconfig `paths`. */
export type AliasMatch =
  | { readonly _tag: 'Matched'; readonly targets: readonly [string, ...string[]] }
  | { readonly _tag: 'Unmatched'; readonly tsconfig: string | undefined };

/** Maps a non-relative specifier of a file in `importerDirectory` through its tsconfig `paths`. */
export type AliasResolver = (importerDirectory: string, specifier: string) => AliasMatch;

/** A parsed tsconfig, and the matches of the specifiers that were looked up in it. */
interface Tsconfig {
  readonly path: string;
  readonly modifiedAt: number;
  readonly matcher: PathsMatcher | null;
  readonly matches: Map<string, AliasMatch>;
}

/**
 * How long the resolver trusts what it read from the filesystem: which tsconfig is nearest to a
 * directory, and whether that tsconfig changed. The answers are stable for a whole lint run, so a
 * walk and a stat per import buy nothing; this keeps a long editor session able to see a tsconfig
 * that is edited, added or removed.
 */
const CHECK_INTERVAL_MS = 1000;

const NO_TSCONFIG: AliasMatch = { _tag: 'Unmatched', tsconfig: undefined };

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

const match = (tsconfig: Tsconfig, specifier: string): AliasMatch => {
  const [first, ...rest] = tsconfig.matcher?.(specifier) ?? [];
  if (first === undefined) {
    return { _tag: 'Unmatched', tsconfig: tsconfig.path };
  }
  return {
    _tag: 'Matched',
    targets: [path.resolve(first), ...rest.map((target) => path.resolve(target))],
  };
};

/**
 * Reads the nearest `tsconfig.json`, with `extends` applied. A parsed config is reused until its
 * modification time changes. The nearest tsconfig of each directory and the modification times
 * are read again at most once per `CHECK_INTERVAL_MS`, and all of them at the same time, so a
 * tsconfig found in one interval was there when that interval started.
 *
 * `now` is a monotonic clock in milliseconds.
 */
export const createTsconfigAliasResolver = (now: () => number = () => performance.now()): AliasResolver => {
  const parsed = new Map<string, Tsconfig>();
  let checkedAt = Number.NEGATIVE_INFINITY;
  /** The nearest tsconfig of each directory in this interval; `null` is a directory with no tsconfig above it. */
  let nearest = new Map<string, Tsconfig | null>();
  /** The tsconfigs whose modification time was read in this interval. */
  let current = new Map<string, Tsconfig | null>();
  /** get-tsconfig's filesystem cache, so that directories with a common ancestor share its lookups. */
  let filesystem: Cache = new Map();

  const startIntervalIfDue = (): void => {
    const time = now();
    if (time - checkedAt < CHECK_INTERVAL_MS) {
      return;
    }
    checkedAt = time;
    nearest = new Map();
    current = new Map();
    filesystem = new Map();
  };

  /** The parsed tsconfig at `tsconfigPath`, parsed again if it changed; `null` if it is gone. */
  const load = (tsconfigPath: string): Tsconfig | null => {
    const stats = statSync(tsconfigPath, { throwIfNoEntry: false });
    if (stats === undefined) {
      parsed.delete(tsconfigPath);
      return null;
    }
    const cached = parsed.get(tsconfigPath);
    if (cached !== undefined && cached.modifiedAt === stats.mtimeMs) {
      return cached;
    }
    const tsconfig: Tsconfig = {
      path: tsconfigPath,
      modifiedAt: stats.mtimeMs,
      matcher: pathsMatcher({ path: tsconfigPath, config: parseTsconfig(tsconfigPath) }),
      matches: new Map(),
    };
    parsed.set(tsconfigPath, tsconfig);
    return tsconfig;
  };

  const loadOnce = (tsconfigPath: string): Tsconfig | null => {
    const cached = current.get(tsconfigPath);
    if (cached !== undefined) {
      return cached;
    }
    const tsconfig = load(tsconfigPath);
    current.set(tsconfigPath, tsconfig);
    return tsconfig;
  };

  const nearestTsconfig = (importerDirectory: string): Tsconfig | null => {
    const cached = nearest.get(importerDirectory);
    if (cached !== undefined) {
      return cached;
    }
    const tsconfigPath = findTsconfig(importerDirectory, 'tsconfig.json', filesystem);
    const tsconfig = tsconfigPath === undefined ? null : loadOnce(tsconfigPath);
    nearest.set(importerDirectory, tsconfig);
    return tsconfig;
  };

  return (importerDirectory, specifier) => {
    startIntervalIfDue();
    const tsconfig = nearestTsconfig(importerDirectory);
    if (tsconfig === null) {
      return NO_TSCONFIG;
    }
    const cached = tsconfig.matches.get(specifier);
    if (cached !== undefined) {
      return cached;
    }
    const result = match(tsconfig, specifier);
    tsconfig.matches.set(specifier, result);
    return result;
  };
};
