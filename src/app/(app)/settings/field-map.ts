import { ar } from '@/i18n/ar'
import { SETTING_KEYS, type SettingKey } from '@/lib/settings/catalog'

/**
 * How each Settings key is *edited*.
 *
 * The catalog (`lib/settings/catalog.ts`) stays the schema of record — what a
 * value must be. This file only says which control renders it, which is a UI
 * concern and has no business being in `lib/`. Adding a setting therefore
 * touches two files, and `tests/unit/settings/field-map.test.ts` fails loudly
 * if the second one is forgotten: every catalog key must appear here, and
 * nothing else may.
 *
 * Imported by both the Server Component and the client editor, so it must not
 * reach `@/lib/settings` (the index pulls in Prisma) — only `catalog`.
 */

export type SettingField =
  /** `<input type="number">`. `unit` is the suffix shown beside the box. */
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'boolean' }
  | { kind: 'select'; options: ReadonlyArray<{ value: string; label: string }> }
  /** `<input type="time">` — the `HH:mm` catalog strings. */
  | { kind: 'time' }
  /** A fixed set of enum members, any subset selectable. */
  | { kind: 'enumSet'; options: ReadonlyArray<{ value: string; label: string }> }
  /** `[{ id, label }]` — a list the operator adds rows to. */
  | { kind: 'taxonomy' }
  /** A plain, ordered list of Arabic strings. */
  | { kind: 'stringList' }
  /** A fixed key set whose Arabic labels are editable. */
  | { kind: 'labelMap'; entries: ReadonlyArray<{ key: string; label: string }> }
  /** Same, but multi-line, with the substitutable variables listed. */
  | {
      kind: 'templateMap'
      entries: ReadonlyArray<{ key: string; label: string }>
      variables: ReadonlyArray<{ token: string; label: string }>
    }

/** `{ FRI: 'الجمعة' }` → `[{ value: 'FRI', label: 'الجمعة' }]`, order preserved. */
function fromEnumLabels(
  labels: Readonly<Record<string, string>>,
): ReadonlyArray<{ value: string; label: string }> {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}

function fromKeyLabels(
  labels: Readonly<Record<string, string>>,
): ReadonlyArray<{ key: string; label: string }> {
  return Object.entries(labels).map(([key, label]) => ({ key, label }))
}

const WHATSAPP_VARIABLES = Object.entries(ar.whatsapp.variables).map(
  ([token, label]) => ({ token, label }),
)

export const SETTING_FIELDS: Readonly<Record<SettingKey, SettingField>> = {
  // ── Penalties ────────────────────────────────────────────────────────────
  'penalty.defaultMode': {
    kind: 'select',
    options: fromEnumLabels(ar.enums.penaltyMode),
  },
  // No unit: the number means currency under FIXED_* and percent under PCT_*,
  // and a suffix that is wrong half the time is worse than none.
  'penalty.defaultValue': { kind: 'number', min: 0, step: 0.01 },
  'penalty.defaultGraceHours': { kind: 'number', min: 0, step: 1, unit: ar.units.hour },
  'penalty.penalizeRevisionLateness': { kind: 'boolean' },

  // ── Calendar ─────────────────────────────────────────────────────────────
  'calendar.weekendDays': { kind: 'enumSet', options: fromEnumLabels(ar.enums.weekday) },
  'calendar.workdayStart': { kind: 'time' },
  'calendar.workdayEnd': { kind: 'time' },
  'calendar.workingDaysPerMonth': {
    kind: 'number',
    min: 1,
    max: 31,
    step: 1,
    unit: ar.units.day,
  },
  'calendar.leaveTypes': { kind: 'taxonomy' },

  // ── Payout ───────────────────────────────────────────────────────────────
  'payout.cycleDay': { kind: 'number', min: 1, max: 28, step: 1 },
  'payout.paymentMethods': { kind: 'stringList' },

  // ── Performance weights ──────────────────────────────────────────────────
  'performance.weightOnTime': { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
  'performance.weightQuality': { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
  'performance.weightVolume': { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
  'performance.weightEstimateAccuracy': {
    kind: 'number',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
  },

  // ── Project health ───────────────────────────────────────────────────────
  'health.overdueTasksThreshold': {
    kind: 'number',
    min: 0,
    step: 1,
    unit: ar.units.task,
  },
  'health.blockedDaysThreshold': { kind: 'number', min: 0, step: 1, unit: ar.units.day },
  'health.amberDaysBeforeDue': { kind: 'number', min: 0, step: 1, unit: ar.units.day },

  // ── Notifications ────────────────────────────────────────────────────────
  'notifications.escalateToPmAfterDays': {
    kind: 'number',
    min: 0,
    step: 1,
    unit: ar.units.day,
  },
  'notifications.escalateToAdminAfterDays': {
    kind: 'number',
    min: 0,
    step: 1,
    unit: ar.units.day,
  },
  'notifications.digestHourCairo': { kind: 'number', min: 0, max: 23, step: 1 },
  'notifications.pollingIntervalSeconds': {
    kind: 'number',
    min: 1,
    step: 1,
    unit: ar.units.second,
  },
  'notifications.dueSoonHours': { kind: 'number', min: 1, step: 1, unit: ar.units.hour },

  // ── Taxonomies ───────────────────────────────────────────────────────────
  'tasks.categories': { kind: 'taxonomy' },
  'tasks.dueSoonDays': { kind: 'number', min: 1, max: 365, step: 1, unit: ar.units.day },
  'projects.engagementTypes': {
    kind: 'enumSet',
    options: fromEnumLabels(ar.enums.engagementType),
  },

  // ── Arabic labels ────────────────────────────────────────────────────────
  // The *keys* come from the enum tables, not from the stored value: a status
  // the operator has never renamed must still appear with a box to rename it.
  'labels.taskStatus': { kind: 'labelMap', entries: fromKeyLabels(ar.enums.taskStatus) },
  'labels.projectStatus': {
    kind: 'labelMap',
    entries: fromKeyLabels(ar.enums.projectStatus),
  },
  'labels.priority': { kind: 'labelMap', entries: fromKeyLabels(ar.enums.priority) },

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  'whatsapp.templates': {
    kind: 'templateMap',
    entries: fromKeyLabels(ar.whatsapp.templateNames),
    variables: WHATSAPP_VARIABLES,
  },

  // ── Security ─────────────────────────────────────────────────────────────
  'security.maxLoginAttempts': { kind: 'number', min: 1, max: 100, step: 1 },
  'security.loginWindowMinutes': {
    kind: 'number',
    min: 1,
    max: 1440,
    step: 1,
    unit: ar.units.minute,
  },
  'security.lockoutMinutes': {
    kind: 'number',
    min: 1,
    max: 1440,
    step: 1,
    unit: ar.units.minute,
  },
  'security.minPasswordLength': { kind: 'number', min: 8, max: 128, step: 1 },
}

export function settingField(key: SettingKey): SettingField {
  return SETTING_FIELDS[key]
}

/** Catalog order, so the page's sections never depend on object-key ordering. */
export const SETTING_KEYS_IN_UI_ORDER: readonly SettingKey[] = SETTING_KEYS
