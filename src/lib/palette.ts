/**
 * lib/palette — which hue means what.
 *
 * SPEC §9's anti-slop rule is "colour carries meaning, chrome stays quiet".
 * This file is the dictionary that makes the first half enforceable: a
 * component never chooses a colour, it looks one up from a datum. If a value
 * has no entry here, it has no colour, and that is the correct outcome —
 * decoration does not get a hue.
 *
 * The hues themselves are defined once in `src/app/globals.css`. Nothing here
 * knows what `emerald` looks like, only that APPROVED is emerald; the two can
 * be retuned independently, and the contrast test guards the CSS side.
 */

/** The ten data hues, plus the deliberate absence of one. */
export const DATA_HUES = [
  'red',
  'orange',
  'amber',
  'lime',
  'emerald',
  'teal',
  'sky',
  'blue',
  'fuchsia',
  'pink',
] as const

export type DataHue = (typeof DATA_HUES)[number]
/** `neutral` is not a colour, it is the statement that this datum has no state. */
export type Hue = DataHue | 'neutral'

/**
 * Task status (SPEC §4). Read down the list: the pipeline runs cold → warm →
 * green, so a board scanned at arm's length shows *progress* as a temperature
 * gradient before any label is read.
 *
 * BACKLOG is neutral on purpose. Nothing has happened to it, and giving "not
 * started yet" a saturated colour is exactly the noise this rule exists to
 * prevent.
 */
export const TASK_STATUS_HUE = {
  BACKLOG: 'neutral',
  ASSIGNED: 'sky',
  IN_PROGRESS: 'blue',
  SUBMITTED: 'teal',
  IN_REVIEW: 'amber',
  REVISION_REQUESTED: 'orange',
  APPROVED: 'emerald',
  DONE: 'lime',
  BLOCKED: 'red',
  CANCELLED: 'pink',
} as const satisfies Record<string, Hue>

export type TaskStatus = keyof typeof TASK_STATUS_HUE

export const PROJECT_STATUS_HUE = {
  DRAFT: 'neutral',
  PROPOSED: 'fuchsia',
  ACTIVE: 'emerald',
  ON_HOLD: 'amber',
  IN_REVIEW: 'blue',
  COMPLETED: 'teal',
  CANCELLED: 'pink',
  ARCHIVED: 'neutral',
} as const satisfies Record<string, Hue>

export type ProjectStatus = keyof typeof PROJECT_STATUS_HUE

/**
 * Priority. LOW is neutral for the same reason BACKLOG is: on a list where
 * most rows are LOW, colouring it means colouring everything, which is the
 * same as colouring nothing.
 */
export const PRIORITY_HUE = {
  LOW: 'neutral',
  MEDIUM: 'sky',
  HIGH: 'orange',
  URGENT: 'red',
} as const satisfies Record<string, Hue>

export type Priority = keyof typeof PRIORITY_HUE

/** Project health (SPEC §5.7). RAG, and RAG only — no fourth colour. */
export const HEALTH_HUE = {
  GREEN: 'emerald',
  AMBER: 'amber',
  RED: 'red',
} as const satisfies Record<string, Hue>

export type Health = keyof typeof HEALTH_HUE

/**
 * Milestone status (Phase 3 addition — not a SPEC §4 enum, see
 * docs/DECISIONS.md). Mirrors the task-status pipeline's cold→warm→green read:
 * nothing has happened yet is neutral, trouble is red.
 */
export const MILESTONE_STATUS_HUE = {
  PENDING: 'neutral',
  IN_PROGRESS: 'sky',
  DONE: 'emerald',
  DELAYED: 'red',
} as const satisfies Record<string, Hue>

export type MilestoneStatus = keyof typeof MILESTONE_STATUS_HUE

/**
 * A project member's per-project role (Phase 3 addition — not a SPEC §4 enum).
 * Identity-ish rather than a pipeline, so a cooler, flatter set: the manager
 * is the one saturated mark, contributor and viewer stay quiet.
 */
export const PROJECT_MEMBER_ROLE_HUE = {
  MANAGER: 'fuchsia',
  CONTRIBUTOR: 'sky',
  VIEWER: 'neutral',
} as const satisfies Record<string, Hue>

export type ProjectMemberRole = keyof typeof PROJECT_MEMBER_ROLE_HUE

/**
 * Ledger entry types (SPEC §4). Fixed here in Phase 2 rather than in Phase 7,
 * because the moment two screens invent their own colour for PENALTY the
 * product has started lying about the thing it exists to explain.
 *
 * Money that *adds* to a payout is green-to-lime; money that *removes* from it
 * is red-to-amber; movements that are neither are cool.
 */
export const LEDGER_TYPE_HUE = {
  EARNING: 'emerald',
  SALARY: 'teal',
  BONUS: 'lime',
  PENALTY: 'red',
  ADVANCE: 'amber',
  ADJUSTMENT: 'sky',
  PAYOUT: 'blue',
  REVERSAL: 'pink',
} as const satisfies Record<string, Hue>

export type LedgerType = keyof typeof LEDGER_TYPE_HUE

/**
 * FNV-1a, 32-bit. Any stable hash would do; this one is four lines, has no
 * dependency, and gives the same answer on the server and in the browser —
 * which matters, because a project whose colour changed on hydration would
 * flicker on every navigation.
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * A hue for an identity that has no intrinsic state: a project, a task
 * category, a person's avatar. Derived from the key so it is stable forever
 * without a colour column, and drawn from the ten data hues — never `neutral`,
 * which would read as "no state" rather than "this one".
 */
export function hueForKey(key: string): DataHue {
  return DATA_HUES[stableHash(key) % DATA_HUES.length]!
}

/**
 * Category hues follow the configured order instead of a hash: categories are
 * a short, ordered, admin-curated list (SPEC §7), and adjacent items in the
 * settings screen looking adjacent on screen is worth more than the hash's
 * even spread. Falls back to hashing past the tenth entry.
 */
export function hueForIndexed(index: number, key: string): DataHue {
  if (index < 0) return hueForKey(key)
  return index < DATA_HUES.length ? DATA_HUES[index]! : hueForKey(key)
}

export const taskStatusHue = (status: string): Hue =>
  TASK_STATUS_HUE[status as TaskStatus] ?? 'neutral'

export const projectStatusHue = (status: string): Hue =>
  PROJECT_STATUS_HUE[status as ProjectStatus] ?? 'neutral'

export const priorityHue = (priority: string): Hue =>
  PRIORITY_HUE[priority as Priority] ?? 'neutral'

export const healthHue = (health: string): Hue =>
  HEALTH_HUE[health as Health] ?? 'neutral'

export const milestoneStatusHue = (status: string): Hue =>
  MILESTONE_STATUS_HUE[status as MilestoneStatus] ?? 'neutral'

export const projectMemberRoleHue = (role: string): Hue =>
  PROJECT_MEMBER_ROLE_HUE[role as ProjectMemberRole] ?? 'neutral'

export const ledgerTypeHue = (type: string): Hue =>
  LEDGER_TYPE_HUE[type as LedgerType] ?? 'neutral'

/**
 * Workload utilisation (Phase 10, `Σ estimatedHours ÷ weeklyCapacityHours`).
 * A function rather than a lookup table like the maps above it: utilisation is
 * continuous, and the one boundary that means something is the definition
 * itself — over 100% *is* over capacity. Adding a second, softer "getting
 * full" band would be a threshold nobody asked for and CLAUDE.md invariant 4
 * would then require living in Settings for no requested behaviour.
 */
export const capacityHue = (utilisationPercent: number): Hue =>
  utilisationPercent > 100 ? 'red' : 'emerald'
