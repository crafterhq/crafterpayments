import { createRequire } from 'node:module';
// @crafterpayments/js build: ESM + CJS (package managers) and UMD (CDN / <script>). The UMD file name is versioned;
// the versioned file on the CDN is immutable and its SRI hash is published in the README (npm run sri).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, renameSync } from 'node:fs';
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
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
};

await build({ ...common, format: 'esm', outfile: join(dist, 'index.mjs') });
await build({ ...common, format: 'cjs', outfile: join(dist, 'index.cjs') });

// UMD: IIFE body inside an AMD / CommonJS / global (window.CrafterPayments) wrapper
const iife = await build({ ...common, format: 'iife', globalName: '__crafterpayments', minify: true, write: false });
const body = iife.outputFiles[0].text.trim();
const banner = `/*! @crafterpayments/js v${pkg.version} | MIT | https://github.com/crafterhq/crafterpayments */`;
const umd = `${banner}
(function(root,factory){if(typeof define==="function"&&define.amd){define([],factory)}else if(typeof module==="object"&&module.exports){module.exports=factory()}else{root.CrafterPayments=factory()}})(typeof self!=="undefined"?self:this,function(){${body}return __crafterpayments});
`;
writeFileSync(join(dist, 'crafterpayments.umd.min.js'), umd);
// Versioned (immutable) file name for the CDN
writeFileSync(join(dist, `crafterpayments-${pkg.version}.umd.min.js`), umd);

// Types
execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')], {
  stdio: 'inherit',
});
writeFileSync(join(dist, 'index.d.ts'), "export * from './types/index';\n");

console.log(`built @crafterpayments/js ${pkg.version}`);
