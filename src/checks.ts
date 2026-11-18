import path from 'node:path';

import type { AliasResolver } from './aliases.ts';
import { findBoundary, isInternalModule, isRelativeOrAbsolute, isWithin, stripSuffix } from './module-path.ts';
import type { Boundary } from './module-path.ts';

/** What a module specifier points to. */
export type Resolution =
  | { readonly _tag: 'Package' }
  | { readonly _tag: 'UnknownAlias'; readonly tsconfig: string | undefined }
  | { readonly _tag: 'Targets'; readonly targets: readonly [string, ...string[]] };

export type ImportViolation =
  | { readonly _tag: 'InternalImport'; readonly boundary: Boundary }
  | { readonly _tag: 'InternalDirectoryImport'; readonly internalDirectory: string };

/** Resolves a module specifier of a file in `importerDirectory`. */
export type SpecifierResolver = (specifier: string, importerDirectory: string) => Resolution;

const resolveModulePath = (modulePath: string, importerDirectory: string, aliases: AliasResolver): Resolution => {
  if (isRelativeOrAbsolute(modulePath)) {
    return { _tag: 'Targets', targets: [path.resolve(importerDirectory, modulePath)] };
  }
  const match = aliases(importerDirectory, modulePath);
  if (match._tag === 'Matched') {
    return { _tag: 'Targets', targets: match.targets };
  }
  if (modulePath.startsWith('#')) {
    return { _tag: 'UnknownAlias', tsconfig: match.tsconfig };
  }
  return { _tag: 'Package' };
};

export const resolveSpecifier = (specifier: string, importerDirectory: string, aliases: AliasResolver): Resolution =>
  resolveModulePath(stripSuffix(specifier), importerDirectory, aliases);

/**
 * `resolveSpecifier`, with the resolution of each relative or absolute specifier kept for its
 * directory, because it depends on no file. `aliases` keeps the other resolutions.
 */
export const createSpecifierResolver = (aliases: AliasResolver): SpecifierResolver => {
  const directories = new Map<string, Map<string, Resolution>>();
  return (specifier, importerDirectory) => {
    const modulePath = stripSuffix(specifier);
    if (!isRelativeOrAbsolute(modulePath)) {
      return resolveModulePath(modulePath, importerDirectory, aliases);
    }
    let resolutions = directories.get(importerDirectory);
    if (resolutions === undefined) {
      resolutions = new Map();
      directories.set(importerDirectory, resolutions);
    }
    const cached = resolutions.get(modulePath);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = resolveModulePath(modulePath, importerDirectory, aliases);
    resolutions.set(modulePath, resolution);
    return resolution;
  };
};

const firstDefined = <A, B>(items: readonly A[], f: (item: A) => B | undefined): B | undefined => {
  for (const item of items) {
    const result = f(item);
    if (result !== undefined) {
      return result;
    }
  }
  return undefined;
};

/** Go's rule: a module under `P/internal/` can be imported only by files under `P/`. */
const internalImport = (importerDirectory: string, target: string): ImportViolation | undefined => {
  const boundary = findBoundary(target);
  return boundary === undefined || isWithin(importerDirectory, boundary.owner) ? undefined : { _tag: 'InternalImport', boundary };
};

/** An import never ends at an `internal` directory or at a module named `internal`. */
const internalDirectoryImport = (target: string): ImportViolation | undefined =>
  isInternalModule(target)
    ? {
        _tag: 'InternalDirectoryImport',
        internalDirectory: path.join(path.dirname(target), 'internal'),
      }
    : undefined;

/**
 * Both import checks, for the first target that breaks one. A file that cannot import the code
 * gets only the internal import, so that it is not told to import a file inside the directory.
 */
export const importViolation = (importerDirectory: string, targets: readonly string[]): ImportViolation | undefined =>
  firstDefined(targets, (target) => internalImport(importerDirectory, target)) ?? firstDefined(targets, internalDirectoryImport);

/**
 * A file can re-export internal code only from inside that code's `internal/` directory,
 * so a re-export never makes code visible to more files.
 */
export const reExportViolation = (importerDirectory: string, targets: readonly string[]): Boundary | undefined =>
  firstDefined(targets, (target) => {
    const boundary = findBoundary(target);
    return boundary === undefined || isWithin(importerDirectory, boundary.internalDirectory) ? undefined : boundary;
  });
