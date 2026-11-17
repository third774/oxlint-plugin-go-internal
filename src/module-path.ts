import path from 'node:path';

const INTERNAL = 'internal';

/** The directory `P` that owns an `internal` directory, and that directory, `P/internal`. */
export interface Boundary {
  readonly owner: string;
  readonly internalDirectory: string;
}

/** The last element of a path up to its first `.`: `store` for `store.ts`, `internal` for `internal.spec.ts`. */
export const moduleName = (modulePath: string): string => {
  const base = path.basename(modulePath);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
};

export const isInternalModule = (modulePath: string): boolean => moduleName(modulePath) === INTERNAL;

/**
 * Go's `findInternal`: the boundary of the last `internal` element of an absolute target path.
 * The last element counts by its module name, so `…/internal.ts` also has a boundary.
 */
export const findBoundary = (target: string): Boundary | undefined => {
  let current = path.resolve(target);
  let name = moduleName(current);
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    if (name === INTERNAL) {
      return { owner: parent, internalDirectory: path.join(parent, INTERNAL) };
    }
    current = parent;
    name = path.basename(current);
  }
};

/** Whether `directory` is `ancestor` or under it, compared by whole path elements. */
export const isWithin = (directory: string, ancestor: string): boolean => {
  const relative = path.relative(ancestor, directory);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** Removes a `?query` or `#hash` suffix. A leading `#` starts an alias and stays. */
export const stripSuffix = (specifier: string): string => {
  const query = specifier.indexOf('?');
  const withoutQuery = query === -1 ? specifier : specifier.slice(0, query);
  const hash = withoutQuery.indexOf('#', 1);
  return hash === -1 ? withoutQuery : withoutQuery.slice(0, hash);
};

export const isRelativeOrAbsolute = (specifier: string): boolean =>
  specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../') || path.isAbsolute(specifier);

/** A path for messages, relative to the working directory. */
export const displayPath = (cwd: string, target: string): string => {
  const relative = path.relative(cwd, target);
  return relative === '' ? '.' : relative;
};
