// Bundle the Vercel serverless functions into self-contained files.
//
// WHY THIS EXISTS
// The functions in api/_src import shared game logic from ../../src (the engine
// analysis, shanten, prompt builders). On Vercel those cross-directory imports
// are NOT packaged into the deployed function, so it crashed at import time with
// FUNCTION_INVOCATION_FAILED before running a single line (confirmed via the
// runtime log: ~150ms, "no outgoing requests", every invocation).
//
// The fix: pre-bundle each entrypoint here with esbuild so ALL of its imports —
// including everything from ../../src — are inlined into one file. The emitted
// api/coach.js / api/review.js have zero external app imports, so there is
// nothing left for Vercel to fail to resolve. esbuild output is deterministic,
// and this runs as part of `npm run build`, so the committed bundles stay fresh.
//
// api/_src/* and api/_lib/* start with an underscore, so Vercel ignores them for
// routing; only the generated api/*.js are deployed as functions.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entries = ['coach', 'review']

const banner = {
  js:
    '// GENERATED — do not edit. Source: api/_src/<name>.ts. Rebuild: npm run build:api\n' +
    '// Self-contained bundle so Vercel deploys a function with no external app imports.',
}

await build({
  entryPoints: entries.map((name) => resolve(root, `api/_src/${name}.ts`)),
  outdir: resolve(root, 'api'),
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner,
  // Node built-ins stay external; everything in-repo (incl. ../../src) is inlined.
  packages: 'bundle',
  logLevel: 'info',
})

console.log(`bundled ${entries.map((n) => `api/${n}.js`).join(', ')}`)
