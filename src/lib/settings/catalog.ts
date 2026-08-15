import { z } from 'zod'

import { ar } from '@/i18n/ar'

/**
 * The settings catalog — the schema of record for every business number in the
 * product (CLAUDE.md invariant 4: "a magic number in a service file is a defect").
 *
 * The DB column is untyped JSON on purpose. This file is what gives it a type,
 * a validator and a default. Adding a setting means adding one line here; the
 * seed, the accessor and the settings page all derive from it.
 */

export const SETTING_GROUPS = [
  'penalty',
  'calendar',
  'payout',
  'performance',
  'health',
  'notifications',
  'tasks',
  'projects',
  'labels',
  'whatsapp',
  'security',
] as const

export type SettingGroup = (typeof SETTING_GROUPS)[number]

/**
 * Authoring helper. Keeping the schema's concrete type (via `S`) is what makes
 * `SettingValue<K>` resolve to `number` rather than `unknown`, and it type-checks
 * every default against its own schema at author time.
 */
function define<S extends z.ZodType>(
  group: SettingGroup,
  schema: S,
  defaultValue: z.infer<S>,
) {
  return { group, schema, default: defaultValue } as const
}

const weekday = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm')
const nonNegative = z.number().min(0)
const positiveInt = z.number().int().positive()
const nonNegativeInt = z.number().int().min(0)
const percentage = z.number().min(0).max(100)

const penaltyMode = z.enum([
  'FIXED_PER_DAY',
  'PCT_TASK_VALUE_PER_DAY',
  'PCT_DAILY_RATE_PER_DAY',
  'FIXED_ONCE',
  'PCT_TASK_VALUE_ONCE',
])

const taskStatus = z.enum([
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'IN_REVIEW',
  'REVISION_REQUESTED',
  'APPROVED',
  'DONE',
  'BLOCKED',
  'CANCELLED',
])

const projectStatus = z.enum([
  'DRAFT',
  'PROPOSED',
  'ACTIVE',
  'ON_HOLD',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
])

const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
const engagementType = z.enum(['FIXED_PRICE', 'RETAINER', 'MILESTONE_BASED', 'HOURLY'])

const nonEmptyArabicList = z.array(z.string().trim().min(1)).min(1)

/**
 * A Settings-defined taxonomy entry: a stable machine id plus an editable
 * Arabic label — the same split SPEC §2 makes for statuses ("Arabic labels are
 * editable in Settings; the enum values are not"), applied to a list the
 * operator also *creates* entries in.
 *
 * Task rows store the id (`Task.categoryId`, SPEC §4), never the label, so
 * renaming "تصميم" to "تصميم جرافيك" is a label change and not a silent
 * re-categorisation of every task ever filed under it.
 */
const taxonomyEntry = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'kebab-case latin id'),
  label: z.string().trim().min(1).max(60),
})

const taxonomyList = z
  .array(taxonomyEntry)
  .min(1)
  .superRefine((entries, ctx) => {
    const ids = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      if (ids.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'duplicate id' })
      }
      ids.add(entry.id)
    }
  })

export type TaxonomyEntry = z.infer<typeof taxonomyEntry>

export const SETTINGS_CATALOG = {
  // ── Penalties (SPEC §5.4) ────────────────────────────────────────────────
  /** Global default penalty formula. Overridable per user via PenaltyProfile. */
  'penalty.defaultMode': define('penalty', penaltyMode, 'PCT_TASK_VALUE_PER_DAY'),
  /** Interpreted per mode: currency for FIXED_*, percent for PCT_*. */
  'penalty.defaultValue': define('penalty', nonNegative, 5),
  'penalty.defaultGraceHours': define('penalty', nonNegativeInt, 24),
  /** SPEC decision T4 — default ON, costs one boolean to turn off. */
  'penalty.penalizeRevisionLateness': define('penalty', z.boolean(), true),

  // ── Calendar (SPEC §4 Calendar, §5.2) ────────────────────────────────────
  'calendar.weekendDays': define('calendar', z.array(weekday).min(0).max(6), [
    'FRI',
    'SAT',
  ]),
  'calendar.workdayStart': define('calendar', timeOfDay, '09:00'),
  'calendar.workdayEnd': define('calendar', timeOfDay, '17:00'),
  /** Divisor for dailyRate(user) = monthlySalary ÷ this. */
  'calendar.workingDaysPerMonth': define('calendar', positiveInt, 22),
  'calendar.leaveTypes': define('calendar', nonEmptyArabicList, [
    ...ar.defaults.leaveTypes,
  ]),

  // ── Payout cycle (SPEC §5.5) ─────────────────────────────────────────────
  /** Capped at 28 so every month has the day — no February special-casing. */
  'payout.cycleDay': define('payout', z.number().int().min(1).max(28), 28),
  'payout.paymentMethods': define('payout', nonEmptyArabicList, [
    ...ar.defaults.paymentMethods,
  ]),

  // ── Performance score (SPEC §5.6) — weights must total 100 ───────────────
  'performance.weightOnTime': define('performance', percentage, 50),
  'performance.weightQuality': define('performance', percentage, 30),
  'performance.weightVolume': define('performance', percentage, 10),
  'performance.weightEstimateAccuracy': define('performance', percentage, 10),

  // ── Project health RAG (SPEC §5.7) ───────────────────────────────────────
  'health.overdueTasksThreshold': define('health', nonNegativeInt, 3),
  'health.blockedDaysThreshold': define('health', nonNegativeInt, 3),
  'health.amberDaysBeforeDue': define('health', nonNegativeInt, 3),

  // ── Notifications & escalation (SPEC §8) ─────────────────────────────────
  'notifications.escalateToPmAfterDays': define('notifications', nonNegativeInt, 2),
  'notifications.escalateToAdminAfterDays': define('notifications', nonNegativeInt, 5),
  'notifications.digestHourCairo': define(
    'notifications',
    z.number().int().min(0).max(23),
    8,
  ),
  'notifications.pollingIntervalSeconds': define('notifications', positiveInt, 30),

  // ── Task & project taxonomy ──────────────────────────────────────────────
  'tasks.categories': define('tasks', taxonomyList, [...ar.defaults.taskCategories]),
  'projects.engagementTypes': define('projects', z.array(engagementType).min(1), [
    'FIXED_PRICE',
    'RETAINER',
    'MILESTONE_BASED',
    'HOURLY',
  ]),

  // ── Editable Arabic labels (SPEC §2: labels editable, enum values are not) ─
  'labels.taskStatus': define('labels', z.record(taskStatus, z.string().min(1)), {
    ...ar.enums.taskStatus,
  }),
  'labels.projectStatus': define('labels', z.record(projectStatus, z.string().min(1)), {
    ...ar.enums.projectStatus,
  }),
  'labels.priority': define('labels', z.record(priority, z.string().min(1)), {
    ...ar.enums.priority,
  }),

  // ── WhatsApp deep-link templates (SPEC §8) ───────────────────────────────
  'whatsapp.templates': define('whatsapp', z.record(z.string(), z.string().min(1)), {
    ...ar.defaults.whatsappTemplates,
  }),

  // ── Login throttling & password policy ───────────────────────────────────
  // These are thresholds, and CLAUDE.md invariant 4 makes no exception for
  // security thresholds: an operator must be able to loosen the lockout during
  // an incident without a redeploy. Read by lib/auth/rate-limit, never inlined.
  /** Failed attempts inside the window before the key is locked out. */
  'security.maxLoginAttempts': define('security', z.number().int().min(1).max(100), 5),
  /** Failures older than this stop counting — the window is sliding, not fixed. */
  'security.loginWindowMinutes': define(
    'security',
    z.number().int().min(1).max(1440),
    15,
  ),
  'security.lockoutMinutes': define('security', z.number().int().min(1).max(1440), 15),
  /**
   * Length only. No composition rules: forcing a symbol and a digit reliably
   * produces `Password1!` and a sticky note, which is worse than a long
   * passphrase an operator actually remembers.
   */
  'security.minPasswordLength': define('security', z.number().int().min(8).max(128), 10),
} as const

export type SettingsCatalog = typeof SETTINGS_CATALOG
export type SettingKey = keyof SettingsCatalog
export type SettingValue<K extends SettingKey> = z.infer<SettingsCatalog[K]['schema']>

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOG) as SettingKey[]

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_CATALOG, key)
}

export function settingDefinition<K extends SettingKey>(key: K): SettingsCatalog[K] {
  return SETTINGS_CATALOG[key]
}

/** Every catalog default, in the shape the seed writes to the DB. */
export function settingSeedRows(): Array<{
  key: SettingKey
  group: SettingGroup
  value: unknown
}> {
  return SETTING_KEYS.map((key) => ({
    key,
    group: SETTINGS_CATALOG[key].group,
    value: SETTINGS_CATALOG[key].default,
  }))
}
