/**
 * tests/helpers/i18n-walk — flattens `src/i18n/ar.ts` into `{ path, value }`
 * leaves, dotted path first (`tasks.actions.approve`).
 *
 * Shared by `register.test.ts` (checks every string's wording) and
 * `coverage.test.ts` (checks every string has been through the Egyptian-Arabic
 * review pass) — both need the same flattening, and a second copy of it would
 * be the kind of duplicate that drifts the moment `ar.ts` gains a new shape of
 * nesting.
 */

export interface I18nLeaf {
  /** Dotted key path, e.g. `tasks.actions.approve` or `months.7`. */
  path: string
  value: string
}

export function walkArabicLeaves(node: unknown, prefix = ''): I18nLeaf[] {
  const leaves: I18nLeaf[] = []

  if (typeof node === 'string') {
    leaves.push({ path: prefix, value: node })
    return leaves
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      leaves.push(...walkArabicLeaves(item, prefix ? `${prefix}.${index}` : String(index)))
    })
    return leaves
  }

  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      leaves.push(...walkArabicLeaves(value, prefix ? `${prefix}.${key}` : key))
    }
    return leaves
  }

  throw new Error(`Unexpected non-string, non-object leaf at "${prefix}": ${String(node)}`)
}
