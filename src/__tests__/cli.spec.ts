import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const oxlint = path.join(packageRoot, 'node_modules/.bin/oxlint');

const projectFiles: Readonly<Record<string, string>> = {
  '.oxlintrc.json': JSON.stringify({
    jsPlugins: [path.join(packageRoot, 'src/index.ts')],
    categories: { correctness: 'off' },
    rules: { 'go-internal/boundaries': 'error' },
  }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '#/*': ['./src/*'] } } }),
  'src/teams/internal/rows.ts': 'export const rows = 1;\n',
  'src/teams/layer.ts': "import { rows } from './internal/rows';\nexport const teamRows = rows;\n",
  'src/teams/internal.ts': 'export const x = 1;\n',
  'src/db/x.ts': "import { rows } from '#/teams/internal/rows';\nexport { rows };\n",
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `file:line message` for each diagnostic in oxlint's JSON output. */
const diagnostics = (output: string): readonly string[] => {
  const parsed: unknown = JSON.parse(output);
  const entries = isRecord(parsed) ? parsed['diagnostics'] : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(`Unexpected oxlint output: ${output}`);
  }
  return entries.map((entry: unknown) => {
    if (!isRecord(entry) || !Array.isArray(entry['labels'])) {
      throw new Error(`Unexpected oxlint diagnostic: ${JSON.stringify(entry)}`);
    }
    const [label]: readonly unknown[] = entry['labels'];
    const span = isRecord(label) ? label['span'] : undefined;
    const line = isRecord(span) ? span['line'] : undefined;
    return `${String(entry['filename'])}:${String(line)} ${String(entry['message'])}`;
  });
};

describe('oxlint CLI', () => {
  let project = '';

  beforeAll(() => {
    project = mkdtempSync(path.join(tmpdir(), 'go-internal-'));
    for (const [file, contents] of Object.entries(projectFiles)) {
      mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      writeFileSync(path.join(project, file), contents);
    }
  });

  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('loads the plugin and reports its errors', { timeout: 30_000 }, () => {
    const result = spawnSync(oxlint, ['-c', '.oxlintrc.json', '-f', 'json', '.'], {
      cwd: project,
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect([...diagnostics(result.stdout)].sort()).toStrictEqual([
      'src/db/x.ts:1 `#/teams/internal/rows` is internal to `src/teams/`. Only files under `src/teams/` can import it. Import a public module of `src/teams/` instead.',
      'src/db/x.ts:2 `rows` comes from `#/teams/internal/rows`, which only files under `src/teams/` can import. Only files inside `src/teams/internal/` can re-export it. To publish it, declare a new export in this file.',
      'src/teams/internal.ts:1 Do not name a module `internal`. `internal` must always be a directory, so that `internal` in an import path has one meaning.',
    ]);
    expect(result.status).toBe(1);
  });
});
