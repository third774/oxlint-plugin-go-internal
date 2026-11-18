/**
 * Measures what the `go-internal/boundaries` rule costs on a generated codebase.
 *
 * The codebase has one scenario per kind of module specifier, so the benchmark shows which
 * specifiers pay for the tsconfig lookup. `rule off` loads the plugin without running the rule,
 * and `none` omits the plugin, so the difference between them and `rule on` is the rule itself.
 *
 * Run it with `pnpm bench`, or against a build from another branch with
 * `node scripts/benchmark.ts --plugin ../other-branch/dist/index.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const oxlintBin = path.join(root, 'node_modules/oxlint/bin/oxlint');
const DEEP = path.join('src', 'a', 'b', 'c', 'd', 'e');
const SCENARIOS = ['relative', 'package', 'alias'] as const;

type Scenario = (typeof SCENARIOS)[number];

interface Options {
  readonly directory: string | undefined;
  readonly files: number;
  readonly imports: number;
  readonly runs: number;
  readonly plugin: string;
  readonly json: boolean;
  readonly keep: boolean;
}

interface Result {
  readonly scenario: Scenario;
  readonly none: number;
  readonly off: number;
  readonly on: number;
}

const parseOptions = (): Options => {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      files: { type: 'string', default: '1000' },
      imports: { type: 'string', default: '20' },
      runs: { type: 'string', default: '5' },
      plugin: { type: 'string', default: path.join(root, 'dist/index.mjs') },
      json: { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
    },
  });
  return {
    directory: values.dir,
    files: Number(values.files),
    imports: Number(values.imports),
    runs: Number(values.runs),
    plugin: path.resolve(values.plugin),
    json: values.json,
    keep: values.keep,
  };
};

const specifier = (scenario: Scenario, index: number): string => {
  switch (scenario) {
    case 'relative':
      return `./impl/mod${index}`;
    case 'package':
      return `some-package-${index}/lib/x`;
    case 'alias':
      return `@/${DEEP.split(path.sep).slice(1).join('/')}/impl/mod${index}`;
  }
};

const writeJson = (file: string, value: unknown): void => {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** Writes one scenario: `files` modules that import `imports` modules, and the modules they import. */
const generate = (directory: string, scenario: Scenario, options: Options): void => {
  const source = path.join(directory, DEEP);
  mkdirSync(path.join(source, 'impl'), { recursive: true });
  writeJson(path.join(directory, 'tsconfig.json'), {
    compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
  });
  for (let file = 0; file < options.files; file += 1) {
    const lines: string[] = [];
    const used: string[] = [];
    for (let index = 0; index < options.imports; index += 1) {
      lines.push(`import { a${index} } from '${specifier(scenario, index)}';`);
      used.push(`a${index}`);
    }
    lines.push(`export const values = [${used.join(', ')}];`);
    writeFileSync(path.join(source, `file${file}.ts`), `${lines.join('\n')}\n`);
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

/** Milliseconds for one `oxlint` run. A rule that reports a problem exits with 1. */
const lint = (directory: string, config: string): number => {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [oxlintBin, '--config', config, 'src', '--quiet'], {
    cwd: directory,
    encoding: 'utf8',
  });
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`oxlint exited with ${String(result.status)}: ${result.stderr}`);
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
  const lines = [
    `| specifiers | oxlint only | plugin, rule off | plugin, rule on | rule cost |`,
    `| --- | --- | --- | --- | --- |`,
    ...results.map(
      (result) =>
        `| ${result.scenario} | ${millis(result.none)} | ${millis(result.off)} | ${millis(result.on)} | +${millis(result.on - result.off)} |`,
    ),
  ];
  return [
    `${options.files} files × ${options.imports} imports = ${(options.files * options.imports).toLocaleString('en-US')} specifiers`,
    '',
    ...lines,
  ].join('\n');
};

const main = (): void => {
  const options = parseOptions();
  const directory = options.directory ?? mkdtempSync(path.join(tmpdir(), 'go-internal-bench-'));
  mkdirSync(directory, { recursive: true });
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
    if (!options.keep) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
};

main();
