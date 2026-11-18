import path from 'node:path';

import { matchPackageImports } from './package-imports.ts';
import type { Project } from './project.ts';
import { findBoundary, isInternalModule, isRelative, hasInternalElement, isWithin, packageSpecifier, stripSuffix } from './module-path.ts';
import type { Boundary } from './module-path.ts';

/** What a module specifier points to. */
export type Resolution =
  | { readonly _tag: 'Package' }
  /** A path under an `internal` element of another package. */
  | { readonly _tag: 'PackageInternal'; readonly packageName: string }
  | {
      readonly _tag: 'UnknownAlias';
      /** The config whose `paths` the specifier does not match, if there is one. */
      readonly config: string | undefined;
      /** The package.json whose `imports` the specifier does not match, for a `#` specifier. */
      readonly packageJson: string | undefined;
    }
  | { readonly _tag: 'Targets'; readonly targets: readonly [string, ...string[]] };

export type ImportViolation =
  | { readonly _tag: 'InternalImport'; readonly boundary: Boundary }
  | { readonly _tag: 'InternalDirectoryImport'; readonly internalDirectory: string };

/** The file whose specifiers are resolved. */
export interface Importer {
  readonly file: string;
  readonly directory: string;
  /** A specifier that matches no alias and starts with `#` or with one of these prefixes is an unknown alias. */
  readonly aliasPrefixes: readonly string[];
  /** Packages whose `internal` paths any file can import. */
  readonly allowedPackages: ReadonlySet<string>;
}

export type SpecifierResolver = (specifier: string, importer: Importer) => Resolution;

const PACKAGE: Resolution = { _tag: 'Package' };

/**
 * A specifier that starts with `/` is a path from the root of the package, as for Vite, unless it
 * is already a path inside that package.
 */
const resolveRooted = (modulePath: string, importerDirectory: string, project: Project): string => {
  const absolute = path.resolve(modulePath);
  const scope = project.packageScope(importerDirectory);
  return scope === undefined || isWithin(absolute, scope.directory) ? absolute : path.join(scope.directory, modulePath);
};

/** Node's subpath imports: the `imports` field of the nearest package.json maps a `#` specifier. */
const resolvePackageImport = (modulePath: string, importerDirectory: string, project: Project, config: string | undefined): Resolution => {
  const scope = project.packageScope(importerDirectory);
  const targets = scope === undefined ? undefined : matchPackageImports(scope.imports, modulePath);
  if (scope === undefined || targets === undefined || targets.length === 0) {
    return { _tag: 'UnknownAlias', config, packageJson: scope?.path };
  }
  const [first, ...rest] = targets.filter(isRelative).map((target) => path.resolve(scope.directory, target));
  // The other targets are package names, which `imports` can map a `#` specifier to.
  return first === undefined ? PACKAGE : { _tag: 'Targets', targets: [first, ...rest] };
};

/**
 * A bare specifier with an `internal` element after its package name. Go's rule applies to
 * packages too, so only the package itself can import it, by its own name. With `baseUrl` set,
 * TypeScript first looks for the specifier under `baseUrl`, so the rule checks it as a path there.
 */
const resolvePackage = (modulePath: string, importer: Importer, project: Project, baseUrl: string | undefined): Resolution => {
  const specifier = modulePath.includes('internal') ? packageSpecifier(modulePath) : undefined;
  if (specifier === undefined || !hasInternalElement(specifier.subpath) || importer.allowedPackages.has(specifier.name)) {
    return PACKAGE;
  }
  const scope = project.packageScope(importer.directory);
  if (scope?.name === specifier.name) {
    return { _tag: 'Targets', targets: [path.resolve(scope.directory, specifier.subpath)] };
  }
  if (baseUrl !== undefined) {
    return { _tag: 'Targets', targets: [path.resolve(baseUrl, modulePath)] };
  }
  return { _tag: 'PackageInternal', packageName: specifier.name };
};

const resolveModulePath = (modulePath: string, importer: Importer, project: Project): Resolution => {
  const { file, directory: importerDirectory, aliasPrefixes } = importer;
  if (isRelative(modulePath)) {
    return { _tag: 'Targets', targets: [path.resolve(importerDirectory, modulePath)] };
  }
  if (modulePath.startsWith('/')) {
    return { _tag: 'Targets', targets: [resolveRooted(modulePath, importerDirectory, project)] };
  }
  if (path.isAbsolute(modulePath)) {
    return { _tag: 'Targets', targets: [path.resolve(modulePath)] };
  }
  const match = project.paths(file, modulePath);
  if (match._tag === 'Matched') {
    return { _tag: 'Targets', targets: match.targets };
  }
  if (modulePath.startsWith('#')) {
    return resolvePackageImport(modulePath, importerDirectory, project, match.config);
  }
  if (aliasPrefixes.some((prefix) => modulePath.startsWith(prefix))) {
    return { _tag: 'UnknownAlias', config: match.config, packageJson: undefined };
  }
  return resolvePackage(modulePath, importer, project, match.baseUrl);
};

/** Resolves a module specifier of a file. */
export const resolveSpecifier = (specifier: string, importer: Importer, project: Project): Resolution =>
  resolveModulePath(stripSuffix(specifier), importer, project);

/**
 * `resolveSpecifier`, with the resolution of each relative specifier kept for its directory,
 * because it depends on no file. `project` keeps what the other resolutions read.
 */
export const createSpecifierResolver = (project: Project): SpecifierResolver => {
  const directories = new Map<string, Map<string, Resolution>>();
  return (specifier, importer) => {
    const modulePath = stripSuffix(specifier);
    if (!isRelative(modulePath)) {
      return resolveModulePath(modulePath, importer, project);
    }
    let resolutions = directories.get(importer.directory);
    if (resolutions === undefined) {
      resolutions = new Map();
      directories.set(importer.directory, resolutions);
    }
    const cached = resolutions.get(modulePath);
    if (cached !== undefined) {
      return cached;
    }
    const resolution = resolveModulePath(modulePath, importer, project);
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
