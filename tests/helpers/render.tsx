import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Testing Library, with cleanup registered.
 *
 * `vitest.config.ts` runs with `globals: false`, so Testing Library's automatic
 * `afterEach(cleanup)` — which it installs only when it finds a global
 * `afterEach` — never runs. Without it, every `render` in a file stacks up in
 * the same document and `getByText` starts failing with "found multiple
 * elements" in whichever test happens to be second.
 *
 * Component tests import from here instead of from `@testing-library/react`, so
 * the fix is in one place rather than in an `afterEach` every file has to
 * remember.
 */
afterEach(cleanup)

export * from '@testing-library/react'
