// Size budget for the ESM entry (minified, react and @crafterpayments/js excluded). Exits with code 1 if exceeded.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET = { minBytes: 8 * 1024, gzipBytes: 3 * 1024 };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(root, 'dist/index.mjs')],
  bundle: true,
  minify: true,
  format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@crafterpayments/js'],
  write: false,
  logLevel: 'silent',
});
const source = Buffer.from(out.outputFiles[0].contents);
const gzip = gzipSync(source, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
console.log(`@crafterpayments/react: ${kb(source.length)} min, ${kb(gzip)} gzip (budget ${kb(BUDGET.minBytes)} / ${kb(BUDGET.gzipBytes)})`);
if (source.length > BUDGET.minBytes || gzip > BUDGET.gzipBytes) {
  console.error('Size budget exceeded.');
  process.exit(1);
}
