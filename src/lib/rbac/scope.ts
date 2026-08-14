import { can, type Actor } from './actor'

/**
 * Row-level scoping — SPEC §6, and CLAUDE.md invariant 3:
 * *"Permissions are enforced in the query layer. Hiding a button is cosmetic."*
 *
 * These helpers return Prisma `where` fragments. A query spreads one in; it
 * never asks the UI what the user is allowed to see, and it never filters in
 * application code after the rows have already left the database. The
 * difference matters most for the case the tests are built around: a
 * `view.assigned` user requesting another project **by direct ID**. If the
 * scope is part of the `where`, that request returns nothing. If it is applied
 * afterwards, someone eventually forgets.
 *
 * ── The SPEC §6 sentence, and how it is read here ──────────────────────────
 *
 *   "*.view.all sees everything; *.view.assigned is limited to projects where
 *    the user is owner/member, or tasks where they are assignee/watcher."
 *
 * Read literally, and deliberately so: a project owner holding only
 * `task.view.assigned` does **not** see every task in their project — they see
 * the ones they are on. Widening that is a policy change and belongs in
 * `docs/SPEC.md` before it belongs in code. Restrictive is the safe direction
 * to be wrong in, and the widening is one `OR` branch away when it is decided.
 *
 * ── Why soft-delete rides along ────────────────────────────────────────────
 *
 * CLAUDE.md invariant 8 requires every query to respect soft-delete. These
 * helpers are the one function every scoped read already has to call, so they
 * carry `deletedAt: null` too. Callers that genuinely want deleted rows — an
 * admin restore screen — pass `includeDeleted` and say so out loud.
 */

/**
 * Loosely typed on purpose: `Project` and `Task` are Phase 3 and Phase 4
 * models, and this module must compile — and be tested — before they exist.
 * The shapes below are asserted against the real models by the query tests in
 * those phases.
 */
export type WhereFragment = Record<string, unknown>

export interface ScopeOptions {
  /** Include soft-deleted rows. Requires a deliberate caller; defaults to false. */
  includeDeleted?: boolean
}

/** What a scope resolved to. Exposed so navigation and tests can be explicit. */
export type ScopeMode = 'all' | 'assigned' | 'none'

/**
 * A fragment that matches nothing. `id: { in: [] }` compiles to a false
 * predicate in Prisma rather than to an absent filter — which is the entire
 * point. Returning `{}` for an unpermitted user would be an unrestricted query.
 */
const MATCH_NOTHING: WhereFragment = { id: { in: [] } }

function softDelete(options: ScopeOptions): WhereFragment {
  return options.includeDeleted ? {} : { deletedAt: null }
}

export function projectScopeMode(actor: Actor | null): ScopeMode {
  if (!actor) return 'none'
  if (can(actor, 'project.view.all')) return 'all'
  if (can(actor, 'project.view.assigned')) return 'assigned'
  return 'none'
}

export function taskScopeMode(actor: Actor | null): ScopeMode {
  if (!actor) return 'none'
  if (can(actor, 'task.view.all')) return 'all'
  if (can(actor, 'task.view.assigned')) return 'assigned'
  return 'none'
}

/**
 * Prisma `where` fragment for the projects this actor may read.
 *
 *   all       → `{ deletedAt: null }`
 *   assigned  → owner of the project, or a row in `ProjectMember`
 *   none      → matches nothing
 */
export function scopeProjects(
  actor: Actor | null,
  options: ScopeOptions = {},
): WhereFragment {
  const base = softDelete(options)
  const mode = projectScopeMode(actor)

  if (mode === 'all') return base
  // `projectScopeMode` only returns 'assigned' for a non-null actor; the guard
  // is what proves that to the type checker without a non-null assertion.
  if (mode === 'assigned' && actor) {
    return {
      ...base,
      OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }],
    }
  }
  return { ...base, ...MATCH_NOTHING }
}

/**
 * Prisma `where` fragment for the tasks this actor may read.
 *
 *   all       → `{ deletedAt: null }`
 *   assigned  → the accountable assignee, or a row in `TaskWatcher`
 *   none      → matches nothing
 */
export function scopeTasks(
  actor: Actor | null,
  options: ScopeOptions = {},
): WhereFragment {
  const base = softDelete(options)
  const mode = taskScopeMode(actor)

  if (mode === 'all') return base
  if (mode === 'assigned' && actor) {
    return {
      ...base,
      OR: [{ assigneeId: actor.id }, { watchers: { some: { userId: actor.id } } }],
    }
  }
  return { ...base, ...MATCH_NOTHING }
}

/**
 * True when the scope can never match a row. Lets a query short-circuit and a
 * page render its "you have no access" empty state without a round trip.
 */
export function isEmptyScope(fragment: WhereFragment): boolean {
  const id = fragment.id
  return (
    typeof id === 'object' &&
    id !== null &&
    Array.isArray((id as { in?: unknown[] }).in) &&
    (id as { in: unknown[] }).in.length === 0
  )
}
