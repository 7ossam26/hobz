import { redirect } from 'next/navigation'

/**
 * The root has no content of its own. Middleware already routes `/` to
 * `/dashboard` or `/login` depending on the session; this redirect is the
 * belt-and-braces for any request that reaches the route directly — a matcher
 * change, or a direct render in a test harness.
 *
 * Phase 0's foundation page lived here. Its RTL and font assertions now run
 * against `/login` and the real app shell (see `tests/e2e/`), which are pages
 * that will still exist in a year.
 */
export default function RootPage() {
  redirect('/dashboard')
}
