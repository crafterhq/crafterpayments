// @crafterpayments/node build: ESM + CJS bundles (no runtime dependencies) and type declarations.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: ['node18'],
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
};

await build({ ...common, format: 'esm', outfile: join(dist, 'index.mjs') });
await build({ ...common, format: 'cjs', outfile: join(dist, 'index.cjs') });

execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], {
  stdio: 'inherit',
});
writeFileSync(join(dist, 'index.d.ts'), "export * from './types/index';\nexport { default } from './types/index';\n");

console.log(`built @crafterpayments/node ${pkg.version}`);
