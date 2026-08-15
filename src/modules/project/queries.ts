import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { scopeProjects } from '@/lib/rbac'
import { getSettings } from '@/lib/settings'

import { taskHealthSignals, type HealthThresholds } from './health'
import { listProjectsSchema } from './schema'
import { getProject, getProjectFacetOptions, listProjects } from './service'
import type { ProjectDetailDto, ProjectFacetOptionsDto, ProjectPageDto } from './types'

/**
 * modules/project/queries.ts — read paths, with RBAC scoping baked in
 * (CLAUDE.md invariant 3, SPEC §6).
 *
 * There is no `assertCan` gate here, deliberately: `project.view.*` is
 * scoped, not all-or-nothing, and `scopeProjects()` is itself the
 * enforcement — a signed-in user holding neither permission gets a fragment
 * that matches nothing (`isEmptyScope`), not a thrown error. The phase brief's
 * requirement ("a `view.assigned` user must never see a project they aren't
 * on, including by direct URL") is exactly what folding the scope into the
 * `where` before the row is ever fetched buys: `getProjectById` on someone
 * else's project resolves to `NotFoundError`, not `ForbiddenError` — the same
 * "restrictive is the safe direction to be wrong in" reasoning `lib/rbac`
 * documents, extended to not even confirming the row exists.
 */

async function healthThresholds(): Promise<HealthThresholds> {
  const settings = await getSettings([
    'health.overdueTasksThreshold',
    'health.blockedDaysThreshold',
    'health.amberDaysBeforeDue',
  ])
  return {
    overdueTasksThreshold: settings['health.overdueTasksThreshold'],
    blockedDaysThreshold: settings['health.blockedDaysThreshold'],
    amberDaysBeforeDue: settings['health.amberDaysBeforeDue'],
  }
}

/**
 * `raw` is untyped rather than `Partial<ListProjectsInput>` — its actual
 * source is `TableState.filters`, a `Record<string, string[]>` straight out of
 * the URL (`components/shared/data-table/state.ts`), which cannot carry the
 * narrowed enum-literal types `listProjectsSchema` parses into. Zod is the
 * real boundary here, the same way it is for every `unknown` a server action
 * receives.
 */
export async function getProjects(
  raw: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<ProjectPageDto> {
  const actor = await requireActor()
  const filters = listProjectsSchema.parse(raw)
  const thresholds = await healthThresholds()
  return listProjects(prisma, {
    scope: scopeProjects(actor),
    filters,
    now,
    thresholds,
    // Phase 4 filled this port in. Passed explicitly rather than defaulted
    // inside the service so the pure-computation tests keep stating their
    // signals inline instead of having to build tasks to imply them.
    taskHealthLookup: taskHealthSignals(now),
  })
}

export async function getProjectById(
  id: string,
  now: Date = new Date(),
): Promise<ProjectDetailDto> {
  const actor = await requireActor()
  const thresholds = await healthThresholds()
  return getProject(prisma, {
    scope: scopeProjects(actor),
    id,
    now,
    thresholds,
    taskHealthLookup: taskHealthSignals(now),
  })
}

/** Owner/client/status facet options for the `/projects` toolbar, scoped like the list itself. */
export async function getProjectFacets(): Promise<ProjectFacetOptionsDto> {
  const actor = await requireActor()
  return getProjectFacetOptions(prisma, scopeProjects(actor))
}
