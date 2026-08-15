/**
 * modules/lateness/escalation.ts — the Settings-driven escalation ladder.
 *
 * The phase brief: "N days overdue → notify PM; M days → notify admin + force
 * project health RED. Emit events; Phase 9 delivers them."
 *
 * ── Why the level is stored on the task rather than derived on read ───────
 *
 * An escalation is an *event*: somebody gets notified, once. A value
 * recomputed on every read has no way to know it has already fired, so it
 * would either notify nightly forever or need a second column recording that
 * it had. `Task.escalationLevel` is that column, and the nightly job is the
 * only writer — it emits exactly when the level *changes*, which is what makes
 * running the job ten times produce one notification (CLAUDE.md invariant 6).
 *
 * ── Why "force RED" is not a health override ──────────────────────────────
 *
 * `Project.healthOverride` means *a human decided this*, and it carries a
 * mandatory reason (SPEC §5.7). Writing to it from a job would erase whichever
 * manager had set it and make "manual override" a lie. So admin-level
 * escalation is a **health signal** instead — `computeProjectHealth` returns
 * RED when a project holds one — and the override keeps meaning what it says.
 */

export type EscalationLevel = 'NONE' | 'PM' | 'ADMIN'

export interface EscalationThresholds {
  /** Working days overdue before the project manager is notified. */
  pmAfterDays: number
  /** …before the admin is notified and project health is forced RED. */
  adminAfterDays: number
}

/**
 * `lateWorkingDays > 0` is required on top of the threshold comparison.
 *
 * Without it a threshold of 0 — a legitimate Settings value meaning "escalate
 * as soon as it slips" — would escalate every task in the agency, because
 * every on-time task also satisfies `0 >= 0`. A task that is not late has
 * nothing to escalate.
 */
export function escalationLevelFor(
  lateWorkingDays: number,
  thresholds: EscalationThresholds,
): EscalationLevel {
  if (lateWorkingDays <= 0) return 'NONE'
  if (lateWorkingDays >= thresholds.adminAfterDays) return 'ADMIN'
  if (lateWorkingDays >= thresholds.pmAfterDays) return 'PM'
  return 'NONE'
}

const ORDER: Record<EscalationLevel, number> = { NONE: 0, PM: 1, ADMIN: 2 }

/**
 * Escalation only ever climbs while a task is still late.
 *
 * Two working days of lateness followed by an approved extension drops the
 * count to zero, and the level must drop with it — otherwise a task keeps a
 * red flag it no longer deserves, and the project stays RED forever. But while
 * the task *is* late, a recount that lands one day lower (a holiday added to
 * Settings after the fact, say) must not un-notify anybody: the PM has already
 * been told.
 */
export function nextEscalationLevel(
  current: EscalationLevel,
  computed: EscalationLevel,
): EscalationLevel {
  if (computed === 'NONE') return 'NONE'
  return ORDER[computed] > ORDER[current] ? computed : current
}
