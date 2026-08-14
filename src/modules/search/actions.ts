'use server'

import { getCommandDirectory } from './queries'
import type { CommandDirectory } from './types'

/**
 * The command palette's one server call, made the first time it opens.
 *
 * Thin by design (SPEC §3): the permission checks and the reads live in
 * `queries.ts`, and this exists only so a Client Component has something it is
 * allowed to `await`.
 */
export async function loadCommandDirectoryAction(): Promise<CommandDirectory> {
  return getCommandDirectory()
}
