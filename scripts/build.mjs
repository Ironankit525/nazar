import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// ESM bundles; createRequire lets bundled CJS deps load Node built-ins.
const banner =
  "import { createRequire as __nazarCreateRequire } from 'node:module';\nconst require = __nazarCreateRequire(import.meta.url);";

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { __NAZAR_VERSION__: JSON.stringify(pkg.version) },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/action/main.ts'], outfile: 'dist/index.js', banner: { js: banner } }),
  build({
    ...common,
    entryPoints: ['src/cli/index.ts'],
    outfile: 'dist/cli.js',
    banner: { js: `#!/usr/bin/env node\n${banner}` },
  }),
]);
