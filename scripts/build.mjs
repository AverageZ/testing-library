import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

await mkdir('dist/adapters', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['react', 'react-dom', 'react-dom/*', './adapters/*.cjs'],
  sourcemap: true,
});
const adapterBuilds = await Promise.all(
  ['17', '18', '19_0', '19_1', '19_2', '19_3'].map(async (version) => {
    return build({
      stdin: {
        contents: `module.exports = require('reconciler${version}');`,
        resolveDir: process.cwd(),
      },
      outfile: `dist/adapters/react${version}.cjs`,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['react'],
      legalComments: 'eof',
      metafile: true,
    });
  }),
);
await writeFile(
  'dist/index.js',
  "import api from './index.cjs';\nexport const { getComponentRenderer, cleanup, QueryTree, Subject, RenderSession } = api;\n",
);

// Redistributed reconciler/scheduler code must retain the full dependency licenses.
const dependencyRoots = new Set();
for (const result of adapterBuilds) {
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(input));
    while (directory !== dirname(directory)) {
      try {
        await readFile(join(directory, 'package.json'), 'utf8');
        dependencyRoots.add(directory);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        directory = dirname(directory);
      }
    }
  }
}
const notices = [];
for (const directory of [...dependencyRoots].sort()) {
  const metadata = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  );
  let license;
  for (const filename of ['LICENSE', 'license', 'LICENSE.md', 'license.md']) {
    try {
      license = await readFile(join(directory, filename), 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!license)
    throw new Error(`Missing redistribution license for ${metadata.name}`);
  notices.push(`${metadata.name}@${metadata.version}\n${license}`);
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', notices.join('\n\n-----\n\n'));
