/**
 * Lints the playground with the plugin source and compares the reports with the
 * `// expect: <messageId>` markers. A line without a marker expects no report.
 *
 *   node fixtures/playground/run.ts          every line with a marker or a report
 *   node fixtures/playground/run.ts --gaps   only the lines where the rule and the marker disagree
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const playground = fileURLToPath(new URL('./', import.meta.url));
const oxlint = fileURLToPath(new URL('../../node_modules/oxlint/bin/oxlint', import.meta.url));
const onlyGaps = process.argv.includes('--gaps');

const MESSAGE_IDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['internalImport', /is internal to .*so only files under/],
  ['internalDirectoryImport', /ends at `internal`/],
  ['internalModuleName', /Do not name a module `internal`/],
  ['internalReExport', /A re-export would make it public/],
  ['unknownAlias', /starts with `#`, but no `paths` entry/],
  ['unresolvedSpecifier', /This module specifier is not a string/],
];

/** A report: the line it starts on, and the rule's `messageId` or oxlint's own message. */
interface Report {
  readonly filename: string;
  readonly line: number;
  readonly id: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const messageId = (message: string): string =>
  MESSAGE_IDS.find(([, pattern]) => pattern.test(message))?.[0] ?? `unknown message: ${message.slice(0, 60)}`;

const parseReport = (entry: unknown): Report => {
  if (
    !isRecord(entry) ||
    typeof entry['filename'] !== 'string' ||
    typeof entry['message'] !== 'string' ||
    !Array.isArray(entry['labels'])
  ) {
    throw new Error(`Unexpected oxlint diagnostic: ${JSON.stringify(entry)}`);
  }
  const [label]: readonly unknown[] = entry['labels'];
  const span = isRecord(label) ? label['span'] : undefined;
  const line = isRecord(span) && typeof span['line'] === 'number' ? span['line'] : 0;
  const { filename, message } = entry;
  return { filename, line, id: entry['code'] === 'go-internal(boundaries)' ? messageId(message) : `${String(entry['code'])}: ${message}` };
};

const lint = (): readonly Report[] => {
  const result = spawnSync(process.execPath, [oxlint, '-c', 'playground.oxlintrc.json', '-f', 'json', '.'], {
    cwd: playground,
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(result.stdout);
  const entries = isRecord(parsed) ? parsed['diagnostics'] : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(`Unexpected oxlint output:\n${result.stdout}${result.stderr}`);
  }
  return entries.map(parseReport);
};

const sourceFiles = (directory: string): string[] =>
  readdirSync(path.join(playground, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(relative);
    }
    return /\.([cm]?[jt]sx?|vue|svelte|astro)$/.test(entry.name) && relative !== 'run.ts' ? [relative] : [];
  });

/** Report ids by file, then by line. */
const reports = new Map<string, Map<number, string[]>>();
for (const { filename, line, id } of lint()) {
  const lines = reports.get(filename) ?? new Map<number, string[]>();
  lines.set(line, [...(lines.get(line) ?? []), id]);
  reports.set(filename, lines);
}

let agree = 0;
let disagree = 0;
for (const file of sourceFiles('.').sort()) {
  const lines = readFileSync(path.join(playground, file), 'utf8').split('\n');
  const fileReports = reports.get(file) ?? new Map<number, string[]>();
  const output: string[] = [];
  lines.forEach((text, index) => {
    const line = index + 1;
    const expected = /expect: (\w+)/.exec(text)?.[1];
    const actual = fileReports.get(line) ?? [];
    if (expected === undefined && actual.length === 0) {
      return;
    }
    const ok = expected !== undefined && actual.length === 1 && actual[0] === expected;
    if (ok) {
      agree += 1;
    } else {
      disagree += 1;
    }
    if (ok && onlyGaps) {
      return;
    }
    const verdict = ok ? 'ok' : expected === undefined ? 'FALSE POSITIVE' : actual.length === 0 ? 'MISSED' : 'DIFFERENT';
    const code = text.replace(/\s*(\/\/ )?expect: \w+/, '').trim();
    output.push(`  ${verdict.padEnd(14)} ${String(line).padStart(3)}  ${code}`);
    if (!ok) {
      output.push(`  ${''.padEnd(19)}expected ${expected ?? 'nothing'}, got ${actual.length === 0 ? 'nothing' : actual.join(', ')}`);
    }
  });
  if (output.length > 0) {
    console.log(`${file}\n${output.join('\n')}\n`);
  }
}
console.log(`${agree} lines as expected, ${disagree} lines differ`);
