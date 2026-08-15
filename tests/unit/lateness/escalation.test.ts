import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings'
import {
  escalationLevelFor,
  nextEscalationLevel,
  type EscalationThresholds,
} from '@/modules/lateness/escalation'

/**
 * The escalation ladder (phase brief §7): N working days overdue notifies the
 * PM, M notifies the admin and forces project health RED.
 *
 * Thresholds are read from the Settings catalog rather than typed in, per
 * docs/TESTING.md §5 — a Settings change must not silently change what these
 * tests mean.
 */

const DEFAULTS: EscalationThresholds = {
  pmAfterDays: SETTINGS_CATALOG['notifications.escalateToPmAfterDays'].default,
  adminAfterDays: SETTINGS_CATALOG['notifications.escalateToAdminAfterDays'].default,
}

describe('escalationLevelFor', () => {
  it('لا تصعيد لمهمة غير متأخرة', () => {
    expect(escalationLevelFor(0, DEFAULTS)).toBe('NONE')
  })

  it('لا تصعيد لعدد أيام سالب', () => {
    expect(escalationLevelFor(-3, DEFAULTS)).toBe('NONE')
  })

  it('لا تصعيد قبل بلوغ حد مدير المشروع', () => {
    expect(escalationLevelFor(DEFAULTS.pmAfterDays - 1, DEFAULTS)).toBe('NONE')
  })

  it('تصعيد لمدير المشروع عند بلوغ الحد بالضبط', () => {
    expect(escalationLevelFor(DEFAULTS.pmAfterDays, DEFAULTS)).toBe('PM')
  })

  it('يبقى عند مدير المشروع حتى حد الإدارة', () => {
    expect(escalationLevelFor(DEFAULTS.adminAfterDays - 1, DEFAULTS)).toBe('PM')
  })

  it('تصعيد للإدارة عند بلوغ حدها بالضبط وما بعده', () => {
    expect(escalationLevelFor(DEFAULTS.adminAfterDays, DEFAULTS)).toBe('ADMIN')
    expect(escalationLevelFor(DEFAULTS.adminAfterDays + 30, DEFAULTS)).toBe('ADMIN')
  })

  it('حد بصفر يومًا يصعّد عند أول يوم تأخير، لا قبله', () => {
    const immediate: EscalationThresholds = { pmAfterDays: 0, adminAfterDays: 99 }
    // The guard that matters: an on-time task also satisfies `0 >= 0`, and
    // must not escalate.
    expect(escalationLevelFor(0, immediate)).toBe('NONE')
    expect(escalationLevelFor(1, immediate)).toBe('PM')
  })

  it('حدود مقلوبة — الأشد يفوز', () => {
    const inverted: EscalationThresholds = { pmAfterDays: 5, adminAfterDays: 2 }
    expect(escalationLevelFor(3, inverted)).toBe('ADMIN')
  })
})

describe('nextEscalationLevel', () => {
  it('يصعد من لا شيء إلى مدير المشروع ثم إلى الإدارة', () => {
    expect(nextEscalationLevel('NONE', 'PM')).toBe('PM')
    expect(nextEscalationLevel('PM', 'ADMIN')).toBe('ADMIN')
  })

  it('لا يتراجع ما دامت المهمة متأخرة', () => {
    // The PM has already been told. A recount that lands one day lower — a
    // holiday added to Settings after the fact — must not un-notify them.
    expect(nextEscalationLevel('ADMIN', 'PM')).toBe('ADMIN')
    expect(nextEscalationLevel('PM', 'PM')).toBe('PM')
  })

  it('يعود إلى لا شيء عندما يزول التأخير تمامًا', () => {
    // An approved extension drops the count to zero, and the flag must drop
    // with it — otherwise the project stays RED forever.
    expect(nextEscalationLevel('ADMIN', 'NONE')).toBe('NONE')
    expect(nextEscalationLevel('PM', 'NONE')).toBe('NONE')
  })

  it('مستقر عند تكرار الحساب', () => {
    let level = nextEscalationLevel('NONE', 'PM')
    for (let run = 0; run < 10; run += 1) level = nextEscalationLevel(level, 'PM')
    expect(level).toBe('PM')
  })
})
