import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const workspace = join(root, '.verification');
const args = process.argv.slice(2);
if (args.length)
  throw new Error(
    'pnpm verify always runs the full acceptance gate; no skipped gates.',
  );

function run(command, argv, cwd = root) {
  console.log(
    `\n[verify] ${cwd === root ? 'root' : cwd.slice(root.length + 1)}: ${command} ${argv.join(' ')}`,
  );
  const result = spawnSync(command, argv, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Verification command failed (${result.status}): ${command} ${argv.join(' ')}`,
    );
}
async function installedVersion(name) {
  return JSON.parse(
    await readFile(require.resolve(`${name}/package.json`), 'utf8'),
  ).version;
}

await mkdir(workspace, { recursive: true });
run('pnpm', ['build']);
run('pnpm', ['typecheck']);
run('pnpm', ['test']);
run('node', ['scripts/package-check.mjs']);
run('pnpm', ['pack', '--pack-destination', workspace]);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const archive = join(
  workspace,
  `${packageJson.name}-${packageJson.version}.tgz`,
);
const common = Object.fromEntries(
  await Promise.all(
    [
      'vitest',
      'jsdom',
      'typescript',
      '@types/node',
      '@testing-library/dom',
    ].map(async (name) => [name, await installedVersion(name)]),
  ),
);
const modernRTL = await installedVersion('@testing-library/react');
const matrix = [
  { react: '17.0.2', types: '^17.0.0', rtl: '12.1.5' },
  { react: '18.2.0', types: '^18.3.0', rtl: modernRTL },
  { react: '18.3.1', types: '^18.3.0', rtl: modernRTL },
  { react: '19.0.0', types: '^19.0.0', rtl: modernRTL },
  { react: '19.1.0', types: '^19.1.0', rtl: modernRTL },
  { react: '19.2.0', types: '^19.2.0', rtl: modernRTL },
];
for (const fixture of matrix) {
  const directory = join(workspace, `react-${fixture.react}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify(
      {
        name: `contract-matrix-${fixture.react}`,
        private: true,
        type: 'module',
        dependencies: {
          ...common,
          'react-contract-renderer': `file:${archive}`,
          react: fixture.react,
          'react-dom': fixture.react,
          '@testing-library/react': fixture.rtl,
          '@types/react': fixture.types,
          '@types/react-dom': fixture.types,
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(directory, '.npmrc'),
    [
      `store-dir=${join(root, '.pnpm-store')}`,
      `cache-dir=${join(root, '.pnpm-cache')}`,
      `state-dir=${join(root, '.pnpm-state')}`,
      'auto-install-peers=false',
      'strict-peer-dependencies=true',
    ].join('\n'),
  );
  await cp('tests', join(directory, 'tests'), { recursive: true });
  await cp('vitest.config.ts', join(directory, 'vitest.config.ts'));
  await cp('scripts/benchmark.mjs', join(directory, 'benchmark.mjs'));
  await cp('scripts/package-check.mjs', join(directory, 'package-check.mjs'));
  const config = JSON.parse(await readFile('tsconfig.json', 'utf8'));
  config.include = [
    'tests/**/*.ts',
    'tests/**/*.tsx',
    'tests/**/*.cts',
    'vitest.config.ts',
  ];
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify(config, null, 2),
  );
  // Re-resolve the packed tarball on every run; lockfiles must not preserve yesterday's build integrity.
  run(
    'pnpm',
    ['install', '--ignore-workspace', '--no-frozen-lockfile', '--force'],
    directory,
  );
  run('pnpm', ['exec', 'tsc', '--noEmit'], directory);
  run('pnpm', ['exec', 'vitest', 'run'], directory);
  run('node', ['package-check.mjs'], directory);
}
run('pnpm', ['benchmark']);
for (const fixture of matrix) {
  run('node', ['benchmark.mjs'], join(workspace, `react-${fixture.react}`));
}
await writeFile(
  resolve(workspace, 'last-success.json'),
  JSON.stringify(
    {
      completedAt: new Date().toISOString(),
      reactVersions: [
        packageJson.devDependencies.react,
        ...matrix.map((entry) => entry.react),
      ],
      gates: [
        'strict-types',
        'contracts',
        'esm-cjs-package',
        'per-fixture-performance',
      ],
    },
    null,
    2,
  ),
);
console.log('\nAll acceptance gates passed across React 17, 18, and 19.');
