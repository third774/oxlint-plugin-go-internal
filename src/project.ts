import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createFilesMatcher, createPathsMatcher, parseTsconfig } from 'get-tsconfig';
import type { FileMatcher, PathsMatcher, TsConfigResult } from 'get-tsconfig';

import { parsePackageImports } from './package-imports.ts';
import type { PackageImports } from './package-imports.ts';

/** The result of matching a non-relative specifier against the `paths` of a tsconfig. */
export type PathsMatch =
  | { readonly _tag: 'Matched'; readonly targets: readonly [string, ...string[]] }
  | {
      readonly _tag: 'Unmatched';
      /** The tsconfig or jsconfig of the importer, if there is one. */
      readonly config: string | undefined;
      /** The absolute `baseUrl` of that config, if it has one. */
      readonly baseUrl: string | undefined;
    };

/** The nearest package.json of a directory: the package that the directory is in. */
export interface PackageScope {
  readonly path: string;
  readonly directory: string;
  readonly name: string | undefined;
  readonly imports: PackageImports;
}

/** What the rule reads from the configuration files around a linted file. */
export interface Project {
  /** Maps a non-relative specifier of the file `importer` through the `paths` of its tsconfig. */
  readonly paths: (importer: string, specifier: string) => PathsMatch;
  /** The nearest package.json at or above `directory`. */
  readonly packageScope: (directory: string) => PackageScope | undefined;
}

/** A parsed tsconfig, and the matches of the specifiers that were looked up in it. */
interface Tsconfig {
  readonly path: string;
  readonly modifiedAt: number;
  readonly matcher: PathsMatcher | null;
  readonly baseUrl: string | undefined;
  /** The config files of its project `references`. */
  readonly references: readonly string[];
  /** Whether its `files`, `include` and `exclude` select a file. */
  readonly includes: (file: string) => boolean;
  readonly matches: Map<string, PathsMatch>;
}

interface PackageJson extends PackageScope {
  readonly modifiedAt: number;
}

/**
 * How long the resolver trusts what it read from the filesystem: which config is nearest to a
 * directory, and whether that config changed. The answers are stable for a whole lint run, so a
 * walk and a stat per import buy nothing; this keeps a long editor session able to see a config
 * that is edited, added or removed.
 */
const CHECK_INTERVAL_MS = 1000;

/** The names that TypeScript looks for in each directory, in order. */
const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/;

const NO_CONFIG: PathsMatch = { _tag: 'Unmatched', config: undefined, baseUrl: undefined };

/**
 * Only `paths` entries count as aliases. With `baseUrl` set, get-tsconfig also maps a specifier
 * that matches no entry to `baseUrl/specifier`, so the matcher is built from absolute targets
 * without `baseUrl`.
 */
const pathsMatcher = (tsconfig: TsConfigResult, baseUrl: string | undefined): PathsMatcher | null => {
  const { paths } = tsconfig.config.compilerOptions ?? {};
  if (paths === undefined) {
    return null;
  }
  if (baseUrl === undefined) {
    return createPathsMatcher(tsconfig);
  }
  const absolutePaths = Object.fromEntries(
    Object.entries(paths).map(([pattern, targets]) => [pattern, targets.map((target) => path.resolve(baseUrl, target))]),
  );
  return createPathsMatcher({
    path: tsconfig.path,
    config: { compilerOptions: { paths: absolutePaths } },
  });
};

/** A reference names a config file or a directory with a `tsconfig.json`. */
const referencePath = (tsconfigPath: string, reference: string): string => {
  const resolved = path.resolve(path.dirname(tsconfigPath), reference);
  return resolved.endsWith('.json') ? resolved : path.join(resolved, 'tsconfig.json');
};

/**
 * Whether a config selects a file. A file with another extension, such as `.vue`, also counts if
 * the config selects it with `.ts` added, as for a config with `"include": ["src"]`.
 */
const filesSelector = (tsconfig: TsConfigResult): ((file: string) => boolean) => {
  let matcher: FileMatcher | undefined;
  return (file) => {
    matcher ??= createFilesMatcher(tsconfig);
    return matcher(file) !== undefined || (!SCRIPT_EXTENSION.test(file) && matcher(`${file}.ts`) !== undefined);
  };
};

const parseConfig = (configPath: string, modifiedAt: number): Tsconfig => {
  const tsconfig: TsConfigResult = { path: configPath, config: parseTsconfig(configPath) };
  const { baseUrl } = tsconfig.config.compilerOptions ?? {};
  const absoluteBaseUrl = baseUrl === undefined ? undefined : path.resolve(path.dirname(configPath), baseUrl);
  return {
    path: configPath,
    modifiedAt,
    matcher: pathsMatcher(tsconfig, absoluteBaseUrl),
    baseUrl: absoluteBaseUrl,
    references: (tsconfig.config.references ?? []).map((reference) => referencePath(configPath, reference.path)),
    includes: filesSelector(tsconfig),
    matches: new Map(),
  };
};

const readJson = (file: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePackageJson = (packageJsonPath: string, modifiedAt: number): PackageJson => {
  const json = readJson(packageJsonPath);
  const name = isRecord(json) ? json['name'] : undefined;
  return {
    path: packageJsonPath,
    directory: path.dirname(packageJsonPath),
    modifiedAt,
    name: typeof name === 'string' ? name : undefined,
    imports: parsePackageImports(isRecord(json) ? json['imports'] : undefined),
  };
};

const match = (tsconfig: Tsconfig, specifier: string): PathsMatch => {
  const [first, ...rest] = tsconfig.matcher?.(specifier) ?? [];
  if (first === undefined) {
    return { _tag: 'Unmatched', config: tsconfig.path, baseUrl: tsconfig.baseUrl };
  }
  return {
    _tag: 'Matched',
    targets: [path.resolve(first), ...rest.map((target) => path.resolve(target))],
  };
};

/**
 * Reads the config files around linted files: the nearest `tsconfig.json` or `jsconfig.json`, with
 * `extends` applied, and the nearest package.json. A parsed file is reused until its modification
 * time changes. Which file is nearest to a directory and the modification times are read again at
 * most once per `CHECK_INTERVAL_MS`, and all of them at the same time, so a file found in one
 * interval was there when that interval started.
 *
 * `now` is a monotonic clock in milliseconds.
 */
export const createProject = (now: () => number = () => performance.now()): Project => {
  const clears: Array<() => void> = [];
  /** A map that is cleared when an interval starts. */
  const intervalMap = <K, V>(): Map<K, V> => {
    const map = new Map<K, V>();
    clears.push(() => map.clear());
    return map;
  };
  let checkedAt = Number.NEGATIVE_INFINITY;

  const startIntervalIfDue = (): void => {
    const time = now();
    if (time - checkedAt >= CHECK_INTERVAL_MS) {
      checkedAt = time;
      for (const clear of clears) {
        clear();
      }
    }
  };

  /** Parses a file once per modification time, and stats it once per interval; `null` if it is not a file. */
  const fileCache = <T extends { readonly modifiedAt: number }>(parse: (file: string, modifiedAt: number) => T) => {
    const parsed = new Map<string, T>();
    const current = intervalMap<string, T | null>();
    const load = (file: string): T | null => {
      const stats = statSync(file, { throwIfNoEntry: false });
      if (stats === undefined || !stats.isFile()) {
        parsed.delete(file);
        return null;
      }
      const cached = parsed.get(file);
      if (cached !== undefined && cached.modifiedAt === stats.mtimeMs) {
        return cached;
      }
      const result = parse(file, stats.mtimeMs);
      parsed.set(file, result);
      return result;
    };
    return (file: string): T | null => {
      const cached = current.get(file);
      if (cached !== undefined) {
        return cached;
      }
      const result = load(file);
      current.set(file, result);
      return result;
    };
  };

  /** The nearest file of a directory, from the first of `names` in it or else from its parent; `null` at the root. */
  const nearestCache = <T extends { readonly modifiedAt: number }>(names: readonly string[], load: (file: string) => T | null) => {
    const nearest = intervalMap<string, T | null>();
    const find = (directory: string): T | null => {
      const cached = nearest.get(directory);
      if (cached !== undefined) {
        return cached;
      }
      let found: T | null = null;
      for (const name of names) {
        found = load(path.join(directory, name));
        if (found !== null) {
          break;
        }
      }
      if (found === null) {
        const parent = path.dirname(directory);
        found = parent === directory ? null : find(parent);
      }
      nearest.set(directory, found);
      return found;
    };
    return find;
  };

  const loadConfig = fileCache(parseConfig);
  const nearestConfig = nearestCache(CONFIG_NAMES, loadConfig);
  const nearestPackageJson = nearestCache(['package.json'], fileCache(parsePackageJson));
  /** The config of each file whose nearest config has `references`. */
  const owners = intervalMap<string, Tsconfig>();

  const referenceOwner = (tsconfig: Tsconfig, file: string, seen: Set<string>): Tsconfig | undefined => {
    for (const reference of tsconfig.references) {
      if (seen.has(reference)) {
        continue;
      }
      seen.add(reference);
      const referenced = loadConfig(reference);
      const owner = referenced === null ? undefined : referenced.includes(file) ? referenced : referenceOwner(referenced, file, seen);
      if (owner !== undefined) {
        return owner;
      }
    }
    return undefined;
  };

  /**
   * The config of a file, as TypeScript's language server finds it: the nearest config, or, if
   * that config does not select the file, the first config in its `references` that does. A
   * solution config, such as Vite's root `tsconfig.json`, has only `references`.
   */
  const configOf = (file: string): Tsconfig | null => {
    const nearest = nearestConfig(path.dirname(file));
    if (nearest === null || nearest.references.length === 0) {
      return nearest;
    }
    const cached = owners.get(file);
    if (cached !== undefined) {
      return cached;
    }
    const owner = (nearest.includes(file) ? undefined : referenceOwner(nearest, file, new Set([nearest.path]))) ?? nearest;
    owners.set(file, owner);
    return owner;
  };

  return {
    paths: (importer, specifier) => {
      startIntervalIfDue();
      const tsconfig = configOf(importer);
      if (tsconfig === null) {
        return NO_CONFIG;
      }
      const cached = tsconfig.matches.get(specifier);
      if (cached !== undefined) {
        return cached;
      }
      const result = match(tsconfig, specifier);
      tsconfig.matches.set(specifier, result);
      return result;
    },
    packageScope: (directory) => {
      startIntervalIfDue();
      return nearestPackageJson(directory) ?? undefined;
    },
  };
};
