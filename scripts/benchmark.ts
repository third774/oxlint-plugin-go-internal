/**
 * Measures what the `go-internal/boundaries` rule costs on a generated codebase.
 *
 * The codebase has one scenario per way that a file refers to a module, so the benchmark shows
 * which of them pay for the tsconfig lookup or for scope analysis. `rule off` loads the plugin
 * without running the rule, and `none` omits the plugin, so the difference between them and
 * `rule on` is the rule itself.
 *
 * Run it with `pnpm bench`, or against a build from another branch with
 * `node scripts/benchmark.ts --plugin ../other-branch/dist/index.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const oxlintBin = path.join(root, 'node_modules/oxlint/bin/oxlint');
const DEEP = ['src', 'a', 'b', 'c', 'd', 'e'];
const SCENARIOS = ['relative', 'package', 'alias', 'local-export', 'require'] as const;

type Scenario = (typeof SCENARIOS)[number];

/** Where the generated codebase goes: a temporary directory that the benchmark removes, or a directory that the user gave. */
type Output = { readonly _tag: 'Temporary' } | { readonly _tag: 'Directory'; readonly path: string };

interface Options {
  readonly output: Output;
  readonly files: number;
  readonly filesPerDirectory: number;
  readonly imports: number;
  readonly statements: number;
  readonly runs: number;
  readonly plugin: string;
  readonly json: boolean;
}

interface Result {
  readonly scenario: Scenario;
  readonly none: number;
  readonly off: number;
  readonly on: number;
}

const positiveInteger = (name: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, not ${value}`);
  }
  return parsed;
};

const parseOptions = (): Options => {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      files: { type: 'string', default: '1500' },
      'files-per-directory': { type: 'string', default: '10' },
      imports: { type: 'string', default: '20' },
      statements: { type: 'string', default: '50' },
      runs: { type: 'string', default: '7' },
      plugin: { type: 'string', default: path.join(root, 'dist/index.mjs') },
      json: { type: 'boolean', default: false },
    },
  });
  return {
    output: values.dir === undefined ? { _tag: 'Temporary' } : { _tag: 'Directory', path: path.resolve(values.dir) },
    files: positiveInteger('files', values.files),
    filesPerDirectory: positiveInteger('files-per-directory', values['files-per-directory']),
    imports: positiveInteger('imports', values.imports),
    statements: positiveInteger('statements', values.statements),
    runs: positiveInteger('runs', values.runs),
    plugin: path.resolve(values.plugin),
    json: values.json,
  };
};

/** The statements that bind `a${index}` to the export of the module `index`, for a file one directory below `DEEP`. */
const binding = (scenario: Scenario, index: number): string => {
  switch (scenario) {
    case 'relative':
    case 'local-export':
      return `import { a${index} } from '../impl/mod${index}';`;
    case 'package':
      return `import { a${index} } from 'some-package-${index}/lib/x';`;
    case 'alias':
      return `import { a${index} } from '@/${DEEP.slice(1).join('/')}/impl/mod${index}';`;
    case 'require':
      return `const { a${index} } = require('../impl/mod${index}');`;
  }
};

/** Code that does not refer to a module, so that the files have something for scope analysis to read. */
const body = (statements: number): string[] => {
  const lines = ['export function work(input: number[]): number {', '  let total = 0;'];
  for (let statement = 0; statement < statements; statement += 1) {
    lines.push(`  total += input.filter((value) => value > ${statement}).map((value) => value * total).length;`);
  }
  lines.push('  return total;', '}');
  return lines;
};

const writeJson = (file: string, value: unknown): void => {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** Writes one scenario: `files` modules, `filesPerDirectory` to a directory, that each use `imports` modules. */
const generate = (directory: string, scenario: Scenario, options: Options): void => {
  const source = path.join(directory, ...DEEP);
  mkdirSync(path.join(source, 'impl'), { recursive: true });
  writeJson(path.join(directory, 'tsconfig.json'), {
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  });
  const names = Array.from({ length: options.imports }, (_, index) => `a${index}`);
  const exports =
    scenario === 'local-export'
      ? [`export { ${names.join(', ')} };`, `export default a0;`]
      : [`export const values = [${names.join(', ')}];`];
  const contents = [...names.map((_, index) => binding(scenario, index)), ...exports, ...body(options.statements)].join('\n');
  for (let file = 0; file < options.files; file += 1) {
    const fileDirectory = path.join(source, `dir${Math.floor(file / options.filesPerDirectory)}`);
    mkdirSync(fileDirectory, { recursive: true });
    writeFileSync(path.join(fileDirectory, `file${file}.ts`), `${contents}\n`);
  }
  for (let index = 0; index < options.imports; index += 1) {
    writeFileSync(path.join(source, 'impl', `mod${index}.ts`), `export const a${index} = ${index};\n`);
  }
};

const configs = (directory: string, options: Options): Record<'none' | 'off' | 'on', string> => {
  const write = (name: string, value: unknown): string => {
    const file = path.join(directory, `${name}.json`);
    writeJson(file, value);
    return file;
  };
  return {
    none: write('none', { plugins: ['typescript'], rules: {} }),
    off: write('off', {
      plugins: ['typescript'],
      jsPlugins: [options.plugin],
      rules: { 'go-internal/boundaries': 'off' },
    }),
    on: write('on', {
      plugins: ['typescript'],
      jsPlugins: [options.plugin],
      rules: { 'go-internal/boundaries': 'error' },
    }),
  };
};

/** Milliseconds for one `oxlint` run. The generated code breaks no rule, so any exit status but 0 is a failure. */
const lint = (directory: string, config: string): number => {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [oxlintBin, '--config', config, 'src', '--quiet'], {
    cwd: directory,
    encoding: 'utf8',
  });
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0) {
    throw new Error(`oxlint exited with ${String(result.status)} in ${directory}:\n${result.stdout}${result.stderr}`);
  }
  return elapsed;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

/** One warmup run, then `runs` timed runs; the median keeps a single slow start out of the result. */
const measure = (directory: string, config: string, runs: number): number => {
  lint(directory, config);
  const times: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    times.push(lint(directory, config));
  }
  return median(times);
};

const millis = (value: number): string => `${value.toFixed(0)}ms`;

const table = (results: readonly Result[], options: Options): string => {
  const directories = Math.ceil(options.files / options.filesPerDirectory);
  return [
    `${options.files} files in ${directories} directories, ${options.imports} module references and ${options.statements} other statements each; median of ${options.runs} runs`,
    '',
    `| scenario | oxlint only | plugin, rule off | plugin, rule on | rule cost |`,
    `| --- | --- | --- | --- | --- |`,
    ...results.map(
      (result) =>
        `| ${result.scenario} | ${millis(result.none)} | ${millis(result.off)} | ${millis(result.on)} | +${millis(result.on - result.off)} |`,
    ),
  ].join('\n');
};

/** The directory to generate into. A directory that the user gave must be empty or new, because the benchmark writes over its files. */
const prepare = (output: Output): string => {
  if (output._tag === 'Temporary') {
    return mkdtempSync(path.join(tmpdir(), 'boundaries-bench-'));
  }
  if (existsSync(output.path) && readdirSync(output.path).length > 0) {
    throw new Error(`--dir ${output.path} is not empty`);
  }
  mkdirSync(output.path, { recursive: true });
  return output.path;
};

const main = (): void => {
  const options = parseOptions();
  const directory = prepare(options.output);
  try {
    const config = configs(directory, options);
    const results = SCENARIOS.map((scenario): Result => {
      const scenarioDirectory = path.join(directory, scenario);
      generate(scenarioDirectory, scenario, options);
      return {
        scenario,
        none: measure(scenarioDirectory, config.none, options.runs),
        off: measure(scenarioDirectory, config.off, options.runs),
        on: measure(scenarioDirectory, config.on, options.runs),
      };
    });
    if (options.json) {
      console.log(JSON.stringify({ options, results }, null, 2));
    } else {
      console.log(table(results, options));
      console.log(`\nplugin: ${options.plugin}\nnode: ${process.version} on ${process.platform} ${process.arch}`);
    }
  } finally {
    if (options.output._tag === 'Temporary') {
      rmSync(directory, { recursive: true, force: true });
    }
  }
};

main();
