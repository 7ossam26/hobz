import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { parseTableState } from '@/components/shared/data-table/state'
import { ar } from '@/i18n/ar'

import { DesignSystemClient } from './design-system-client'

export const metadata: Metadata = { title: ar.designSystem.title }

/**
 * `/design-system` — every component, both themes, both densities, in Arabic.
 *
 * **Development only.** In production it is a 404, which is the honest status:
 * there is no such page for a user of this product. It is not hidden behind a
 * permission, because a permission implies somebody could be granted it.
 *
 * What it is for, concretely: seeing all ten data hues beside each other before
 * assigning one to a new status; checking that a chip, a flag and a badge are
 * still distinguishable at compact density; and confirming that a component
 * added in Phase 7 looks like it belongs to the same product as one added here.
 */
export default async function DesignSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()

  // The sample table is driven the same way a real one is — through the URL —
  // so the gallery exercises the real code path rather than a mock of it.
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value)
  }

  return <DesignSystemClient tableState={parseTableState(params)} />
}
