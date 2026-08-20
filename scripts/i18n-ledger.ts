/**
 * scripts/i18n-ledger.ts — syncs `src/i18n/review-ledger.json` against the
 * live `ar` object.
 *
 * The ledger is what makes "did the Egyptian-Arabic rewrite actually cover
 * every string in `ar.ts`?" a question a test can answer instead of a claim
 * a PR description makes. Each leaf key path gets one entry:
 * `{ status: 'pending' | 'reviewed' }`. `tests/unit/i18n/coverage.test.ts`
 * asserts the ledger's key set matches `ar`'s exactly (so a renamed or new key
 * can't silently skip review) and, separately, that every entry is
 * `'reviewed'`.
 *
 * Usage:
 *   pnpm tsx scripts/i18n-ledger.ts sync              # add new keys as
 *                                                      # 'pending', drop keys
 *                                                      # that no longer exist
 *   pnpm tsx scripts/i18n-ledger.ts review <prefix>    # mark every key under
 *                                                      # a dotted prefix
 *                                                      # 'reviewed' (e.g.
 *                                                      # `tasks` or
 *                                                      # `penalties.notes`)
 *   pnpm tsx scripts/i18n-ledger.ts status             # print a coverage
 *                                                      # summary and exit
 *                                                      # non-zero if anything
 *                                                      # is still pending
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ar } from '../src/i18n/ar'

const LEDGER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'i18n',
  'review-ledger.json',
)

type LedgerEntry = { status: 'pending' | 'reviewed' }
type Ledger = Record<string, LedgerEntry>

function walkKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  if (Array.isArray(node)) {
    return node.flatMap((item, index) =>
      walkKeys(item, prefix ? `${prefix}.${index}` : String(index)),
    )
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      walkKeys(value, prefix ? `${prefix}.${key}` : key),
    )
  }
  throw new Error(`Unexpected leaf at "${prefix}"`)
}

function readLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger
  } catch {
    return {}
  }
}

function writeLedger(ledger: Ledger): void {
  const sorted: Ledger = {}
  for (const key of Object.keys(ledger).sort()) sorted[key] = ledger[key]!
  writeFileSync(LEDGER_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
}

function sync(): void {
  const currentKeys = new Set(walkKeys(ar))
  const ledger = readLedger()

  let added = 0
  let removed = 0

  for (const key of currentKeys) {
    if (!(key in ledger)) {
      ledger[key] = { status: 'pending' }
      added++
    }
  }
  for (const key of Object.keys(ledger)) {
    if (!currentKeys.has(key)) {
      delete ledger[key]
      removed++
    }
  }

  writeLedger(ledger)
  console.info(`[i18n-ledger] sync: ${added} added, ${removed} removed, ${currentKeys.size} total`)
}

function review(prefix: string): void {
  if (!prefix) throw new Error('usage: i18n-ledger review <dotted.prefix>')
  const ledger = readLedger()
  let marked = 0
  for (const key of Object.keys(ledger)) {
    if (key === prefix || key.startsWith(`${prefix}.`)) {
      ledger[key] = { status: 'reviewed' }
      marked++
    }
  }
  if (marked === 0) throw new Error(`no ledger keys match prefix "${prefix}"`)
  writeLedger(ledger)
  console.info(`[i18n-ledger] reviewed: ${marked} keys under "${prefix}"`)
}

function status(): void {
  const ledger = readLedger()
  const entries = Object.entries(ledger)
  const reviewed = entries.filter(([, v]) => v.status === 'reviewed').length
  console.info(`[i18n-ledger] ${reviewed}/${entries.length} reviewed`)
  if (reviewed < entries.length) {
    const pending = entries.filter(([, v]) => v.status === 'pending').map(([k]) => k)
    console.info(`[i18n-ledger] ${pending.length} pending, e.g.:`)
    for (const key of pending.slice(0, 10)) console.info(`  ${key}`)
    process.exitCode = 1
  }
}

const [command, arg] = process.argv.slice(2)
if (command === 'sync') sync()
else if (command === 'review') review(arg ?? '')
else if (command === 'status') status()
else {
  console.error('usage: tsx scripts/i18n-ledger.ts <sync|review <prefix>|status>')
  process.exitCode = 1
}
