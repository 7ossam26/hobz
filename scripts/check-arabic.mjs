#!/usr/bin/env node
/**
 * scripts/check-arabic.mjs — an independent, AST-based check that Arabic
 * literals live only in `src/i18n/**`.
 *
 * `eslint.config.mjs`'s `no-restricted-syntax` rule already enforces this —
 * but `next.config.ts` sets `eslint.ignoreDuringBuilds: true` ("linting is a
 * separate, explicit `pnpm lint` step"), so a stray literal does not fail
 * `next build`, only a lint run somebody remembers to invoke. This is that
 * check again, dependency-light and independently runnable (`pnpm i18n:check`),
 * so it can sit in front of the rewrite in this phase and in CI later without
 * dragging in every other lint rule.
 *
 * Deliberately real parsing, not a comment-stripping regex: the TypeScript
 * compiler already knows the difference between a string literal, a
 * `RegExpLiteral` (`src/lib/phone.ts`'s digit-fold ranges — the alphabet, not
 * copy, and out of scope the same way it is for ESLint), and a comment,
 * without a hand-rolled tokenizer risking a false positive on some string
 * containing `//`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

/** Mirrors eslint.config.mjs's `no-restricted-syntax` exemption blocks. */
const EXEMPT_PATHS = [/^src\/i18n\//, /^src\/lib\/search\.ts$/]

function isExempt(relPath) {
  const normalized = relPath.replaceAll('\\', '/')
  return EXEMPT_PATHS.some((re) => re.test(normalized))
}

function listSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...listSourceFiles(full))
    else if (['.ts', '.tsx'].includes(extname(entry))) out.push(full)
  }
  return out
}

/** Node kinds that can carry user-facing text (never a comment, never a regex). */
const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

function checkFile(absPath, relPath) {
  const text = readFileSync(absPath, 'utf8')
  if (!ARABIC_RE.test(text)) return []

  const source = ts.createSourceFile(
    absPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const violations = []
  const visit = (node) => {
    if (TEXT_KINDS.has(node.kind)) {
      const raw = node.getText(source)
      if (ARABIC_RE.test(raw)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        violations.push({ line: line + 1, text: raw.trim().slice(0, 60) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

function main() {
  const files = listSourceFiles(join(ROOT, 'src'))
  const findings = []

  for (const absPath of files) {
    const relPath = relative(ROOT, absPath)
    if (isExempt(relPath)) continue
    for (const violation of checkFile(absPath, relPath)) {
      findings.push({ file: relPath, ...violation })
    }
  }

  if (findings.length === 0) {
    console.info(`[i18n:check] OK — no Arabic literals outside src/i18n/ (${files.length} files scanned)`)
    return
  }

  console.error(`[i18n:check] ${findings.length} Arabic literal(s) found outside src/i18n/:\n`)
  for (const { file, line, text } of findings) {
    console.error(`  ${file}:${line}  ${text}`)
  }
  console.error(
    '\nArabic strings live in src/i18n/ar.ts (CLAUDE.md). If this is alphabet data, not copy, add it to EXEMPT_PATHS in this script and to eslint.config.mjs.',
  )
  process.exitCode = 1
}

main()
