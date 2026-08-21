import { recordAudit } from '@/lib/audit'
import type { Db } from '@/lib/db'
import { ConflictError, DomainError, NotFoundError } from '@/lib/errors'
import type { Actor, WhereFragment } from '@/lib/rbac'
import { normalizeArabic } from '@/lib/search'

import { nextProjectCode } from './code'
import {
  computeProjectHealth,
  effectiveProjectHealth,
  noTaskHealthSignals,
  type ComputedHealth,
  type HealthThresholds,
  type ProjectHealthSignals,
  type TaskHealthLookup,
} from './health'
import {
  NO_CLIENT_FACET_VALUE,
  type AddProjectMemberInput,
  type CreateProjectInput,
  type EngagementType,
  type ListProjectsInput,
  type RemoveProjectMemberInput,
  type SetProjectHealthOverrideInput,
  type UpdateProjectInput,
  type UpdateProjectMemberRoleInput,
} from './schema'
import type {
  ProjectClientRefDto,
  ProjectDetailDto,
  ProjectFacetOptionsDto,
  ProjectOwnerRefDto,
  ProjectPageDto,
  ProjectSummaryDto,
} from './types'

/**
 * modules/project/service.ts — pure functions, dependency-injected Prisma
 * client, no `next/*` import (CLAUDE.md architecture rules).
 *
 * Row-level scoping is a caller concern: read paths take a `scope`
 * `WhereFragment` — `scopeProjects(actor)` from `lib/rbac`, computed by
 * `queries.ts` — and spread it straight into the query's `where`. That is
 * what makes "a `view.assigned` user must not read another project even by
 * direct ID" true here rather than in the page that links to it.
 */

const OWNER_SELECT = {
  id: true,
  fullName: true,
  username: true,
  phone: true,
  isActive: true,
} as const

const CLIENT_REF_SELECT = { id: true, name: true } as const

const PROJECT_SUMMARY_SELECT = {
  id: true,
  code: true,
  name: true,
  clientId: true,
  client: { select: CLIENT_REF_SELECT },
  owner: { select: OWNER_SELECT },
  engagementType: true,
  status: true,
  startDate: true,
  dueDate: true,
  healthOverride: true,
  healthReason: true,
  _count: { select: { milestones: true, members: true } },
} as const

const PROJECT_DETAIL_SELECT = {
  ...PROJECT_SUMMARY_SELECT,
  gracePeriodHours: true,
  penalizeRevisionLateness: true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: {
      userId: true,
      role: true,
      addedAt: true,
      user: { select: OWNER_SELECT },
    },
  },
} as const

type SummaryRow = {
  id: string
  code: string
  name: string
  clientId: string | null
  client: ProjectClientRefDto | null
  owner: ProjectOwnerRefDto
  engagementType: string
  status: string
  startDate: Date
  dueDate: Date
  healthOverride: string | null
  healthReason: string | null
  _count: { milestones: number; members: number }
}

/**
 * Health signals for a whole page in one go.
 *
 * The list paths used to call the lookup per row, which is three statements per
 * project — measured at 25 statements for six projects, and the same path backs
 * the manager dashboard's at-risk card and the project-summary report. A lookup
 * that advertises `batch` answers the page in three; one that does not (a test
 * fake) falls back to the per-row call and behaves exactly as before.
 */
async function signalsFor(
  db: Db,
  lookup: TaskHealthLookup,
  rows: readonly SummaryRow[],
): Promise<Map<string, ProjectHealthSignals> | null> {
  if (!lookup.batch || rows.length === 0) return null
  return lookup.batch(
    db,
    rows.map((row) => row.id),
  )
}

type DetailRow = SummaryRow & {
  gracePeriodHours: number | null
  penalizeRevisionLateness: boolean | null
  createdAt: Date
  updatedAt: Date
  members: Array<{
    userId: string
    role: string
    addedAt: Date
    user: ProjectOwnerRefDto
  }>
}

async function toSummaryDto(
  db: Db,
  row: SummaryRow,
  now: Date,
  thresholds: HealthThresholds,
  lookup: TaskHealthLookup,
  /** Prefetched by `signalsFor` on list paths; absent for a single project. */
  precomputed?: ProjectHealthSignals,
): Promise<ProjectSummaryDto> {
  const signals = precomputed ?? (await lookup(db, row.id))
  const computed = computeProjectHealth({
    status: row.status,
    dueDate: row.dueDate,
    now,
    signals,
    thresholds,
  })
  const health = effectiveProjectHealth(
    computed,
    row.healthOverride as ComputedHealth | null,
    row.healthReason,
  )

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    client: row.client,
    owner: row.owner,
    engagementType: row.engagementType as EngagementType,
    status: row.status as ProjectSummaryDto['status'],
    startDate: row.startDate,
    dueDate: row.dueDate,
    health,
    milestoneCount: row._count.milestones,
    memberCount: row._count.members,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

const SORT_FIELDS = new Set(['code', 'name', 'status', 'startDate', 'dueDate'])

function projectOrderBy(sort: string | undefined, dir: 'asc' | 'desc' | undefined) {
  const direction = dir ?? 'asc'
  if (sort && SORT_FIELDS.has(sort)) return { [sort]: direction }
  return { createdAt: 'desc' as const }
}

function clientFilterFragment(values: readonly string[]): WhereFragment {
  const real = values.filter((v) => v !== NO_CLIENT_FACET_VALUE)
  const includeNone = values.includes(NO_CLIENT_FACET_VALUE)
  if (includeNone && real.length > 0) {
    return { OR: [{ clientId: null }, { clientId: { in: real } }] }
  }
  if (includeNone) return { clientId: null }
  return { clientId: { in: real } }
}

export interface ListProjectsArgs {
  scope: WhereFragment
  filters: ListProjectsInput
  now: Date
  thresholds: HealthThresholds
  taskHealthLookup?: TaskHealthLookup
}

export async function listProjects(
  db: Db,
  args: ListProjectsArgs,
): Promise<ProjectPageDto> {
  const { filters } = args
  const lookup = args.taskHealthLookup ?? noTaskHealthSignals

  const conditions: WhereFragment[] = [args.scope]

  // Arabic-aware search, applied in application code rather than pushed onto
  // `conditions` as a Prisma `contains`. Postgres `ILIKE` (what `contains` +
  // `mode: 'insensitive'` compiles to) case-folds but does not fold Arabic
  // orthographic variants — `احمد` would never match a project named `مشروع
  // أحمد` (docs/TESTING.md §4 axis 10). `lib/search`'s fold table is what
  // closes that gap for the command palette (`modules/search/queries.ts`),
  // and it can only run in JS, not inside a `WHERE` clause. The same Phase 2
  // precedent applies here at SPEC §2's capped scale: fetch the
  // scope-and-other-filtered candidate rows once, then fold/match/paginate
  // them below instead of in the database. See
  // `modules/client/service.ts`'s `listClients` for the identical pattern.
  const searchNeedle = filters.search ? normalizeArabic(filters.search) : null

  if (filters.status && filters.status.length > 0) {
    conditions.push({ status: { in: filters.status } })
  }
  if (filters.id?.length) {
    conditions.push({ id: { in: filters.id } })
  }
  if (filters.ownerId && filters.ownerId.length > 0) {
    conditions.push({ ownerId: { in: filters.ownerId } })
  }
  if (filters.clientId && filters.clientId.length > 0) {
    conditions.push(clientFilterFragment(filters.clientId))
  }
  if (filters.dueFrom || filters.dueTo) {
    conditions.push({
      dueDate: {
        ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
        ...(filters.dueTo ? { lte: filters.dueTo } : {}),
      },
    })
  }
  const where: WhereFragment =
    conditions.length === 1 ? conditions[0]! : { AND: conditions }
  const orderBy = projectOrderBy(filters.sort, filters.dir)

  /**
   * Health is filtered in application code, not in the `WHERE`.
   *
   * Phase 3 pushed it down as `healthWhereFragment`, which was correct exactly
   * while task signals were hardcoded to zero: RED reduced to "past due date",
   * which SQL can express. Phase 4 gave `TaskHealthLookup` a real query, so RED
   * now also means "more overdue tasks than the threshold" or "blocked longer
   * than N days" — a per-project aggregate over another table, against
   * Settings-driven thresholds, that Prisma cannot put in a `where` without
   * raw SQL. Phase 3's note named the two ways out; this is the second one,
   * and it has the property that matters: the facet filters on *the same*
   * `computeProjectHealth` the row itself displays, so a project can never be
   * missing from its own health filter.
   */
  const healthFilter = filters.health && filters.health.length > 0 ? filters.health : null

  if (searchNeedle !== null || healthFilter !== null) {
    const needle = searchNeedle
    const candidates = await db.project.findMany({
      where,
      select: PROJECT_SUMMARY_SELECT,
      orderBy,
    })
    const textMatched =
      needle === null
        ? candidates
        : candidates.filter(
            (row) =>
              normalizeArabic(row.name).includes(needle) ||
              normalizeArabic(row.code).includes(needle),
          )

    const signals = await signalsFor(db, lookup, textMatched)
    const computed = await Promise.all(
      textMatched.map((row) =>
        toSummaryDto(
          db,
          row,
          args.now,
          args.thresholds,
          lookup,
          signals?.get(row.id),
        ),
      ),
    )
    const matched =
      healthFilter === null
        ? computed
        : computed.filter((dto) => healthFilter.includes(dto.health.health))

    const start = (filters.page - 1) * filters.pageSize
    return {
      items: matched.slice(start, start + filters.pageSize),
      total: matched.length,
      page: filters.page,
      pageSize: filters.pageSize,
    }
  }

  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      select: PROJECT_SUMMARY_SELECT,
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.project.count({ where }),
  ])

  const signals = await signalsFor(db, lookup, rows)
  const items = await Promise.all(
    rows.map((row) =>
      toSummaryDto(db, row, args.now, args.thresholds, lookup, signals?.get(row.id)),
    ),
  )

  return { items, total, page: filters.page, pageSize: filters.pageSize }
}

export interface GetProjectArgs {
  scope: WhereFragment
  id: string
  now: Date
  thresholds: HealthThresholds
  taskHealthLookup?: TaskHealthLookup
}

export async function getProject(
  db: Db,
  args: GetProjectArgs,
): Promise<ProjectDetailDto> {
  const lookup = args.taskHealthLookup ?? noTaskHealthSignals

  const row = (await db.project.findFirst({
    where: { ...args.scope, id: args.id },
    select: PROJECT_DETAIL_SELECT,
  })) as DetailRow | null
  if (!row) throw new NotFoundError('Project', args.id)

  const summary = await toSummaryDto(db, row, args.now, args.thresholds, lookup)

  return {
    ...summary,
    gracePeriodHours: row.gracePeriodHours,
    penalizeRevisionLateness: row.penalizeRevisionLateness,
    members: row.members
      .map((m) => ({
        userId: m.userId,
        role: m.role as ProjectDetailDto['members'][number]['role'],
        addedAt: m.addedAt,
        fullName: m.user.fullName,
        username: m.user.username,
        phone: m.user.phone,
        isActive: m.user.isActive,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>()
  for (const row of rows) seen.set(row.id, row)
  return [...seen.values()]
}

/** Facet option lists — scoped, so a filter menu never names a project a user cannot see. */
export async function getProjectFacetOptions(
  db: Db,
  scope: WhereFragment,
): Promise<ProjectFacetOptionsDto> {
  // `select`-ing a to-one relation follows the FK unconditionally — Prisma
  // has no global soft-delete middleware here (see lib/db.ts), so without an
  // explicit `deletedAt: null` on the relation itself, a soft-deleted owner
  // or client still referenced by a live project would keep appearing in
  // this facet's filter menu forever (CLAUDE.md invariant 8; found by the
  // docs/TESTING.md §4 axis 11 edge-case sweep). Filtering the *parent*
  // project by `owner: { deletedAt: null }` / `client: { deletedAt: null }`
  // is what excludes it — the project itself stays visible everywhere else,
  // only its contribution to this distinct-value list is dropped.
  const [ownerRows, clientRows, statusGroups] = await Promise.all([
    db.project.findMany({
      where: { ...scope, owner: { deletedAt: null } },
      select: { owner: { select: OWNER_SELECT } },
      distinct: ['ownerId'],
    }),
    db.project.findMany({
      where: { ...scope, clientId: { not: null }, client: { deletedAt: null } },
      select: { client: { select: CLIENT_REF_SELECT } },
      distinct: ['clientId'],
    }),
    db.project.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
  ])

  const owners = dedupeById(ownerRows.map((r) => r.owner)).sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'ar'),
  )
  const clients = dedupeById(
    clientRows.map((r) => r.client).filter((c): c is ProjectClientRefDto => c !== null),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ar'))

  const statusCounts: ProjectFacetOptionsDto['statusCounts'] = {}
  for (const group of statusGroups) {
    statusCounts[group.status as keyof ProjectFacetOptionsDto['statusCounts']] =
      group._count._all
  }

  return { owners, clients, statusCounts }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectMutationArgs {
  actor: Actor
  ip?: string | undefined
}

function isUniqueCodeConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

async function assertEngagementTypeEnabled(
  input: { engagementType: EngagementType },
  enabled: readonly EngagementType[],
): Promise<void> {
  if (!enabled.includes(input.engagementType)) {
    throw new DomainError('projects.engagementTypeDisabled', {
      engagementType: input.engagementType,
    })
  }
}

async function assertOwnerExists(db: Db, ownerId: string): Promise<void> {
  const owner = await db.user.findFirst({
    where: { id: ownerId, deletedAt: null },
    select: { id: true },
  })
  if (!owner) throw new NotFoundError('User', ownerId)
}

async function assertClientExists(db: Db, clientId: string | null): Promise<void> {
  if (!clientId) return
  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true },
  })
  if (!client) throw new NotFoundError('Client', clientId)
}

export async function createProject(
  db: Db,
  args: ProjectMutationArgs & {
    input: CreateProjectInput
    enabledEngagementTypes: readonly EngagementType[]
  },
): Promise<{ id: string }> {
  const { input } = args
  await assertEngagementTypeEnabled(input, args.enabledEngagementTypes)
  await assertOwnerExists(db, input.ownerId)
  await assertClientExists(db, input.clientId)

  const data = {
    name: input.name,
    clientId: input.clientId,
    ownerId: input.ownerId,
    engagementType: input.engagementType,
    status: input.status,
    startDate: input.startDate,
    dueDate: input.dueDate,
    gracePeriodHours: input.gracePeriodHours,
    penalizeRevisionLateness: input.penalizeRevisionLateness,
  }

  const code = input.code ?? (await nextProjectCode(db))

  let project: { id: string }
  try {
    project = await db.project.create({ data: { ...data, code }, select: { id: true } })
  } catch (error) {
    // A race on the auto-generated sequence (see modules/project/code.ts) —
    // one retry against a fresh code is enough at SPEC §2's scale. A
    // hand-typed, already-taken code is a real conflict and surfaces as one.
    if (input.code === null && isUniqueCodeConflict(error)) {
      const retryCode = await nextProjectCode(db)
      project = await db.project.create({
        data: { ...data, code: retryCode },
        select: { id: true },
      })
    } else if (isUniqueCodeConflict(error)) {
      throw new ConflictError('projects.codeTaken', { code })
    } else {
      throw error
    }
  }

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.created',
    entity: 'Project',
    entityId: project.id,
    after: { code, ...data },
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return project
}

export async function updateProject(
  db: Db,
  args: ProjectMutationArgs & {
    input: UpdateProjectInput
    enabledEngagementTypes: readonly EngagementType[]
  },
): Promise<{ id: string }> {
  const { input } = args

  const before = await db.project.findFirst({
    where: { id: input.id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      clientId: true,
      ownerId: true,
      engagementType: true,
      status: true,
      startDate: true,
      dueDate: true,
      gracePeriodHours: true,
      penalizeRevisionLateness: true,
    },
  })
  if (!before) throw new NotFoundError('Project', input.id)

  await assertEngagementTypeEnabled(input, args.enabledEngagementTypes)
  await assertOwnerExists(db, input.ownerId)
  await assertClientExists(db, input.clientId)

  if (input.code !== before.code) {
    const clash = await db.project.findUnique({
      where: { code: input.code },
      select: { id: true },
    })
    if (clash) throw new ConflictError('projects.codeTaken', { code: input.code })
  }

  const data = {
    code: input.code,
    name: input.name,
    clientId: input.clientId,
    ownerId: input.ownerId,
    engagementType: input.engagementType,
    status: input.status,
    startDate: input.startDate,
    dueDate: input.dueDate,
    gracePeriodHours: input.gracePeriodHours,
    penalizeRevisionLateness: input.penalizeRevisionLateness,
  }

  await db.project.update({ where: { id: before.id }, data })

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.updated',
    entity: 'Project',
    entityId: before.id,
    before,
    after: data,
    ...(args.ip ? { ip: args.ip } : {}),
  })

  return { id: before.id }
}

/** Soft-delete (CLAUDE.md invariant 8). Members and milestones stay, invisible with it. */
export async function deleteProject(
  db: Db,
  args: ProjectMutationArgs & { id: string },
): Promise<void> {
  const project = await db.project.findFirst({
    where: { id: args.id, deletedAt: null },
    select: { id: true, code: true, name: true },
  })
  if (!project) throw new NotFoundError('Project', args.id)

  await db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } })

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.deleted',
    entity: 'Project',
    entityId: project.id,
    before: { deletedAt: null },
    after: {
      deletedAt: new Date().toISOString(),
      code: project.code,
      name: project.name,
    },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

/**
 * SPEC §5.7: manual RAG override, mandatory reason, audit-logged — the exact
 * requirement the phase brief calls out. Clearing (`health: null`) is written
 * and audited the same way: it is still a decision about how the project's
 * status should read, just the decision to trust the computation again.
 */
export async function setProjectHealthOverride(
  db: Db,
  args: ProjectMutationArgs & { input: SetProjectHealthOverrideInput },
): Promise<void> {
  const { input } = args

  const before = await db.project.findFirst({
    where: { id: input.id, deletedAt: null },
    select: { id: true, healthOverride: true, healthReason: true },
  })
  if (!before) throw new NotFoundError('Project', input.id)

  // `healthReason` mirrors `healthOverride`'s presence: it is the current
  // override's justification, not a log of the last thing that happened to
  // it. Clearing the override clears the reason from the *row* too — the
  // reason given for clearing still lands on the audit entry below, which is
  // where "why was this cleared" belongs once there is no live override left
  // to attach it to.
  const storedReason = input.health === null ? null : input.reason

  await db.project.update({
    where: { id: before.id },
    data: { healthOverride: input.health, healthReason: storedReason },
  })

  await recordAudit(db, {
    actor: args.actor,
    action:
      input.health === null
        ? 'project.healthOverrideCleared'
        : 'project.healthOverrideSet',
    entity: 'Project',
    entityId: before.id,
    before: { healthOverride: before.healthOverride, healthReason: before.healthReason },
    after: { healthOverride: input.health, healthReason: storedReason },
    reason: input.reason,
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Team (SPEC §4: "members with per-project role")
// ─────────────────────────────────────────────────────────────────────────────

export async function addProjectMember(
  db: Db,
  args: ProjectMutationArgs & { input: AddProjectMemberInput },
): Promise<void> {
  const { input } = args

  const project = await db.project.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { id: true },
  })
  if (!project) throw new NotFoundError('Project', input.projectId)

  const user = await db.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true },
  })
  if (!user) throw new NotFoundError('User', input.userId)

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
  })
  if (existing) throw new ConflictError('projects.team.alreadyMember')

  await db.projectMember.create({
    data: { projectId: input.projectId, userId: input.userId, role: input.role },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.membersChanged',
    entity: 'Project',
    entityId: input.projectId,
    after: { added: { userId: input.userId, role: input.role } },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export async function updateProjectMemberRole(
  db: Db,
  args: ProjectMutationArgs & { input: UpdateProjectMemberRoleInput },
): Promise<void> {
  const { input } = args

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
  })
  if (!existing)
    throw new NotFoundError('ProjectMember', `${input.projectId}:${input.userId}`)
  if (existing.role === input.role) return

  await db.projectMember.update({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
    data: { role: input.role },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.membersChanged',
    entity: 'Project',
    entityId: input.projectId,
    before: { userId: input.userId, role: existing.role },
    after: { userId: input.userId, role: input.role },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}

export async function removeProjectMember(
  db: Db,
  args: ProjectMutationArgs & { input: RemoveProjectMemberInput },
): Promise<void> {
  const { input } = args

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
  })
  if (!existing)
    throw new NotFoundError('ProjectMember', `${input.projectId}:${input.userId}`)

  await db.projectMember.delete({
    where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
  })

  await recordAudit(db, {
    actor: args.actor,
    action: 'project.membersChanged',
    entity: 'Project',
    entityId: input.projectId,
    before: { removed: { userId: input.userId, role: existing.role } },
    ...(args.ip ? { ip: args.ip } : {}),
  })
}
