// Fails the build/tests if an Anthropic key (or a client-exposed key env var)
// appears anywhere in source or build output. Spec §2.1.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src', 'api', 'dist'].filter(existsSync)
const KEY_PATTERN = /sk-ant-[a-zA-Z0-9_-]{8,}/
const VITE_KEY_PATTERN = /VITE_[A-Z_]*(?:ANTHROPIC|API_KEY)/

const offenders = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (st.size < 5_000_000) {
      const text = readFileSync(p, 'utf8')
      if (KEY_PATTERN.test(text)) offenders.push(`${p}: contains an sk-ant- key`)
      if (VITE_KEY_PATTERN.test(text)) offenders.push(`${p}: references a VITE_-exposed key variable`)
    }
  }
}
for (const root of ROOTS) walk(root)

if (offenders.length > 0) {
  console.error('KEY HYGIENE CHECK FAILED:')
  for (const o of offenders) console.error('  ' + o)
  process.exit(1)
}
console.log(`key hygiene ok (${ROOTS.join(', ')})`)
