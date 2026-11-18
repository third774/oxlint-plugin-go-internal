/** A target of a package.json `imports` entry: a path, conditions, fallbacks, or `null` for no target. */
export type ImportsTarget = string | null | readonly ImportsTarget[] | { readonly [condition: string]: ImportsTarget };

/** The entries of a package.json `imports` field, keyed by their `#` specifier or pattern. */
export type PackageImports = ReadonlyMap<string, ImportsTarget>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseTarget = (value: unknown): ImportsTarget | undefined => {
  if (typeof value === 'string' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const targets: ImportsTarget[] = [];
    for (const item of value) {
      const target = parseTarget(item);
      if (target !== undefined) {
        targets.push(target);
      }
    }
    return targets;
  }
  if (isRecord(value)) {
    const conditions: Record<string, ImportsTarget> = {};
    for (const [condition, item] of Object.entries(value)) {
      const target = parseTarget(item);
      if (target !== undefined) {
        conditions[condition] = target;
      }
    }
    return conditions;
  }
  return undefined;
};

/** The entries of the `imports` field of a parsed package.json. Entries that Node would reject are left out. */
export const parsePackageImports = (imports: unknown): PackageImports => {
  const entries = new Map<string, ImportsTarget>();
  if (!isRecord(imports)) {
    return entries;
  }
  for (const [key, value] of Object.entries(imports)) {
    const target = parseTarget(value);
    if (key.startsWith('#') && key !== '#' && target !== undefined) {
      entries.set(key, target);
    }
  }
  return entries;
};

/** Every path in a target, with each `*` replaced by `match`. Every condition counts, because any of them can apply. */
const targetPaths = (target: ImportsTarget, match: string): string[] => {
  if (target === null) {
    return [];
  }
  if (typeof target === 'string') {
    return [target.replaceAll('*', match)];
  }
  const items: readonly ImportsTarget[] = Array.isArray(target) ? target : Object.values(target);
  return items.flatMap((item) => targetPaths(item, match));
};

/**
 * Node's `PATTERN_KEY_COMPARE`: whether pattern key `a` is a better match than `b`.
 * A longer part before the `*` wins, and for the same part, a longer key wins.
 */
const isBetterPattern = (a: string, b: string): boolean => {
  const baseA = a.indexOf('*');
  const baseB = b.indexOf('*');
  return baseA === baseB ? a.length > b.length : baseA > baseB;
};

/**
 * Node's `PACKAGE_IMPORTS_RESOLVE` for a `#` specifier, without the filesystem: the paths of the
 * entry that matches it, relative to the package directory, or `undefined` if no entry matches.
 */
export const matchPackageImports = (imports: PackageImports, specifier: string): readonly string[] | undefined => {
  const exact = imports.get(specifier);
  if (exact !== undefined && !specifier.includes('*')) {
    return targetPaths(exact, '');
  }
  let best: { readonly key: string; readonly target: ImportsTarget; readonly match: string } | undefined;
  for (const [key, target] of imports) {
    const star = key.indexOf('*');
    if (star === -1 || star !== key.lastIndexOf('*')) {
      continue;
    }
    const base = key.slice(0, star);
    const trailer = key.slice(star + 1);
    if (
      specifier.startsWith(base) &&
      specifier.length >= key.length &&
      specifier.endsWith(trailer) &&
      (best === undefined || isBetterPattern(key, best.key))
    ) {
      best = { key, target, match: specifier.slice(star, specifier.length - trailer.length) };
    }
  }
  return best === undefined ? undefined : targetPaths(best.target, best.match);
};
