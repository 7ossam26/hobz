/**
 * Next.js hands a Server Component's `searchParams` as a plain object whose
 * values are `string | string[] | undefined` (an array only when the same key
 * repeats in the URL). `parseTableState` (this folder, `state.ts`) is written
 * against a real `URLSearchParams` — shared with the client toolbar, which
 * only ever produces one — so this is the one place that bridges the two.
 *
 * Every `/*` page that server-renders a `DataTable` needs this; it lives here
 * rather than being copied into each page, the same reasoning `state.ts`
 * itself documents for keeping URL parsing in one place.
 */
export function fromNextSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    usp.set(key, Array.isArray(value) ? (value[0] ?? '') : value)
  }
  return usp
}
