import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createSpecifierResolver, importViolation, reExportViolation, resolveSpecifier } from '../checks.ts';
import type { Importer } from '../checks.ts';
import { DEFAULT_ALIAS_PREFIXES } from '../options.ts';
import { createProject } from '../project.ts';

const src = fileURLToPath(new URL('../../fixtures/project/src/', import.meta.url));
const project = createProject();

/** A file in `directory`, with the default options. */
const importer = (directory: string): Importer => ({
  file: path.join(directory, 'x.ts'),
  directory,
  aliasPrefixes: DEFAULT_ALIAS_PREFIXES,
  allowedPackages: new Set(),
});

const segments = (minLength: number) =>
  fc.array(fc.constantFrom('a', 'b', 'internal', 'internals', 'Internal'), {
    minLength,
    maxLength: 5,
  });

const outcome = (importerDirectory: string, specifier: string) => {
  const resolution = resolveSpecifier(specifier, importer(importerDirectory), project);
  return resolution._tag === 'Targets'
    ? {
        targets: resolution.targets,
        imports: importViolation(importerDirectory, resolution.targets),
        reExport: reExportViolation(importerDirectory, resolution.targets),
      }
    : resolution;
};

describe('checks', () => {
  it('give the same result for a relative specifier and an alias of the same target', () => {
    fc.assert(
      fc.property(segments(0), segments(1), (importerElements, target) => {
        const importerDirectory = path.join(src, ...importerElements);
        const targetPath = path.join(src, ...target);
        const relative = path.relative(importerDirectory, targetPath).split(path.sep).join('/');
        const relativeSpecifier = relative.startsWith('..') ? relative : `./${relative}`;
        const aliasSpecifier = `#/${target.join('/')}`;

        expect(outcome(importerDirectory, relativeSpecifier)).toStrictEqual(outcome(importerDirectory, aliasSpecifier));
      }),
    );
  });

  it('resolve a specifier the same way when they keep resolutions', () => {
    const resolve = createSpecifierResolver(project);
    fc.assert(
      fc.property(segments(0), segments(1), fc.constantFrom('./', '../', '#/', 'package/'), (importerElements, target, prefix) => {
        const file = importer(path.join(src, ...importerElements));
        const specifier = `${prefix}${target.join('/')}`;
        const expected = resolveSpecifier(specifier, file, project);

        expect(resolve(specifier, file)).toStrictEqual(expected);
        expect(resolve(specifier, file)).toStrictEqual(expected);
      }),
    );
  });

  it('check a package specifier with an `internal` element as internal to its package', () => {
    fc.assert(
      fc.property(segments(0), segments(1), fc.constantFrom('package', '@scope/package'), (importerElements, subpath, name) => {
        const importerDirectory = path.join(src, ...importerElements);
        const resolution = resolveSpecifier(`${name}/${subpath.join('/')}`, importer(importerDirectory), project);

        expect(resolution).toStrictEqual(
          subpath.includes('internal') ? { _tag: 'PackageInternal', packageName: name } : { _tag: 'Package' },
        );
      }),
    );
  });

  it('allow the import of every re-export that they allow', () => {
    fc.assert(
      fc.property(segments(0), segments(1), (importerElements, target) => {
        const importerDirectory = path.join(src, ...importerElements);
        const targets = [path.join(src, ...target)];

        fc.pre(reExportViolation(importerDirectory, targets) === undefined);

        expect(importViolation(importerDirectory, targets)?._tag).not.toBe('InternalImport');
      }),
    );
  });
});
