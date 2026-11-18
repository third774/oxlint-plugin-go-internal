import { describe, expect, it } from 'vitest';

import { matchPackageImports, parsePackageImports } from '../package-imports.ts';

describe('package.json imports', () => {
  const imports = parsePackageImports({
    '#exact': './exact.js',
    '#*': './any/*.js',
    '#lib/*': './lib/*.js',
    '#lib/private/*': null,
    '#lib/*.css': './styles/*.css',
    '#conditions': { node: ['./node.js', { import: './import.mjs' }], default: './default.js' },
    '#package': 'some-package/x',
    invalid: './invalid.js',
    '#number': 1,
  });

  it('keeps only the entries whose key starts with `#` and whose target Node accepts', () => {
    expect([...imports.keys()]).toStrictEqual(['#exact', '#*', '#lib/*', '#lib/private/*', '#lib/*.css', '#conditions', '#package']);
  });

  it.each([
    ['#exact', ['./exact.js']],
    ['#lib/a/b', ['./lib/a/b.js']],
    ['#lib/a.css', ['./styles/a.css']],
    ['#other', ['./any/other.js']],
    ['#lib/private/x', []],
    ['#conditions', ['./node.js', './import.mjs', './default.js']],
    ['#package', ['some-package/x']],
  ])('matches %s as Node does, with every condition', (specifier, targets) => {
    expect(matchPackageImports(imports, specifier)).toStrictEqual(targets);
  });

  it('matches nothing for a specifier that no key matches', () => {
    const lib = parsePackageImports({ '#lib/*': './lib/*.js' });
    expect(matchPackageImports(lib, '#lib/')).toBeUndefined();
    expect(matchPackageImports(lib, '#other')).toBeUndefined();
  });
});
