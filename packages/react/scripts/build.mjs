// @crafterpayments/react build: ESM + CJS + type declarations. react and @crafterpayments/js stay external.
// Every entry starts with "use client" so the components work in the Next.js App Router.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  target: ['es2020'],
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@crafterpayments/js'],
  banner: { js: '"use client";' },
  legalComments: 'none',
  logLevel: 'warning',
};

await build({ ...common, format: 'esm', outfile: join(dist, 'index.mjs') });
await build({ ...common, format: 'cjs', outfile: join(dist, 'index.cjs') });

execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], {
  stdio: 'inherit',
});
writeFileSync(join(dist, 'index.d.ts'), "export * from './types/index';\n");

console.log(`built @crafterpayments/react ${pkg.version}`);
