/**
 * scripts/scan-client-bundle.mjs — "confirm no secret is bundled client-side".
 *
 *   node scripts/scan-client-bundle.mjs      # exits 1 on any finding
 *
 * Run after `next build`. Reads every file the browser can download from
 * `.next/static` and looks for three separate classes of leak:
 *
 *  1. **The live values** of the secrets this deployment actually holds
 *     (`AUTH_SECRET`, the database password, the seed admin password). This is
 *     the check with teeth: it does not care how a secret got there.
 *  2. **Server-only env var names**, which is how a leak usually starts — a
 *     `process.env.AUTH_SECRET` reference surviving into a client component
 *     tells you the boundary was crossed even when the value was undefined at
 *     build time.
 *  3. **Shapes** that are secrets whoever wrote them: a `postgres://` URL with
 *     credentials, a PEM private key header, a bcrypt hash.
 *
 * Anything genuinely public belongs in a `NEXT_PUBLIC_*` variable, and those
 * are deliberately not flagged.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_DIR = resolve(ROOT, '.next', 'static')

try {
  process.loadEnvFile(resolve(ROOT, '.env'))
} catch {
  // CI supplies these directly; the name and shape checks still run.
}

/** Env vars whose *value* must never appear in a browser-downloadable file. */
const SECRET_ENV_VARS = [
  'AUTH_SECRET',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'SEED_ADMIN_PASSWORD',
]

/** Env var *names* that must never be referenced from client code. */
const SERVER_ONLY_NAMES = [
  'AUTH_SECRET',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'SEED_ADMIN_PASSWORD',
  'SEED_ADMIN_USERNAME',
  'BACKUP_DIR',
]

const SECRET_SHAPES = [
  {
    name: 'postgres URL with credentials',
    pattern: /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]*@/,
  },
  {
    name: 'PEM private key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  { name: 'bcrypt hash', pattern: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/ },
]

/**
 * Values too short or too common to search for without drowning in false
 * positives — an 8-character password would match minified identifiers.
 */
const MIN_SECRET_LENGTH = 12

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function main() {
  let files
  try {
    files = walk(STATIC_DIR)
  } catch {
    console.error('No .next/static — run `next build` first.')
    process.exitCode = 1
    return
  }

  const secretValues = SECRET_ENV_VARS.map((name) => ({
    name,
    value: process.env[name] ?? '',
  })).filter((entry) => entry.value.length >= MIN_SECRET_LENGTH)

  const skippedValues = SECRET_ENV_VARS.filter(
    (name) => (process.env[name] ?? '').length < MIN_SECRET_LENGTH,
  )

  const findings = []

  for (const file of files) {
    // Fonts and images cannot carry a string leak worth finding, and reading
    // them as UTF-8 produces noise.
    if (/\.(woff2?|png|jpe?g|gif|ico|avif|webp)$/i.test(file)) continue

    const text = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file)

    for (const secret of secretValues) {
      if (text.includes(secret.value)) {
        findings.push(`${rel}: contains the value of ${secret.name}`)
      }
    }
    for (const name of SERVER_ONLY_NAMES) {
      if (text.includes(name)) findings.push(`${rel}: references ${name}`)
    }
    for (const shape of SECRET_SHAPES) {
      if (shape.pattern.test(text)) findings.push(`${rel}: matches ${shape.name}`)
    }
  }

  console.info(`scanned ${files.length} files under .next/static`)
  console.info(`checked ${secretValues.length} live secret value(s)`)
  if (skippedValues.length > 0) {
    console.info(
      `not set (or too short) in this environment: ${skippedValues.join(', ')}`,
    )
  }

  if (findings.length === 0) {
    console.info('no secret found in the client bundle')
    return
  }

  console.error('\nFINDINGS:')
  for (const finding of findings) console.error(`  ${finding}`)
  process.exitCode = 1
}

main()
