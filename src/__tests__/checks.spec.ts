import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createTsconfigAliasResolver } from '../aliases.ts';
import { importViolations, reExportViolation, resolveSpecifier } from '../checks.ts';

const project = fileURLToPath(new URL('../../fixtures/project/', import.meta.url));
const src = path.join(project, 'src');
const aliases = createTsconfigAliasResolver();

const segments = (minLength: number) =>
  fc.array(fc.constantFrom('a', 'b', 'internal', 'internals', 'Internal'), {
    minLength,
    maxLength: 5,
  });

const outcome = (importerDirectory: string, specifier: string) => {
  const resolution = resolveSpecifier(specifier, importerDirectory, aliases);
  return resolution._tag === 'Targets'
    ? {
        targets: resolution.targets,
        imports: importViolations(importerDirectory, resolution.targets),
        reExport: reExportViolation(importerDirectory, resolution.targets),
      }
    : resolution;
};

describe('checks', () => {
  it('give the same result for a relative specifier and an alias of the same target', () => {
    fc.assert(
      fc.property(segments(0), segments(1), (importer, target) => {
        const importerDirectory = path.join(src, ...importer);
        const targetPath = path.join(src, ...target);
        const relative = path.relative(importerDirectory, targetPath).split(path.sep).join('/');
        const relativeSpecifier = relative.startsWith('..') ? relative : `./${relative}`;
        const aliasSpecifier = `#/${target.join('/')}`;

        expect(outcome(importerDirectory, relativeSpecifier)).toStrictEqual(outcome(importerDirectory, aliasSpecifier));
      }),
    );
  });

  it('allow the import of every re-export that they allow', () => {
    fc.assert(
      fc.property(segments(0), segments(1), (importer, target) => {
        const importerDirectory = path.join(src, ...importer);
        const targets = [path.join(src, ...target)];

        fc.pre(reExportViolation(importerDirectory, targets) === undefined);

        expect(importViolations(importerDirectory, targets).filter((violation) => violation._tag === 'InternalImport')).toStrictEqual([]);
      }),
    );
  });
});
