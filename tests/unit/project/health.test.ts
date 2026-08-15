import { describe, expect, it } from 'vitest'

import {
  computeProjectHealth,
  effectiveProjectHealth,
  TERMINAL_PROJECT_STATUSES,
  type ComputedHealth,
  type HealthThresholds,
} from '@/modules/project/health'

/**
 * SPEC §5.7: "RED if any: overdue tasks > threshold, project past `dueDate`,
 * blocked > N days. AMBER if approaching."
 *
 * docs/TESTING.md §4 axis 1 (boundaries): 0, 1, exactly-at-deadline, one
 * [unit] after, max values — every case below is named for the boundary it
 * pins down.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const THRESHOLDS: HealthThresholds = {
  overdueTasksThreshold: 3,
  blockedDaysThreshold: 3,
  amberDaysBeforeDue: 3,
}
const NO_SIGNALS = { overdueTaskCount: 0, maxBlockedDays: 0, adminEscalationCount: 0 }
const DUE = new Date('2026-03-15T12:00:00.000Z')

function health(
  now: Date,
  overrides: Partial<{ status: string; thresholds: HealthThresholds }> = {},
): ComputedHealth {
  return computeProjectHealth({
    status: overrides.status ?? 'ACTIVE',
    dueDate: DUE,
    now,
    signals: NO_SIGNALS,
    thresholds: overrides.thresholds ?? THRESHOLDS,
  })
}

describe('computeProjectHealth — الحدود الزمنية حول الموعد النهائي', () => {
  it('أخضر عندما يكون الموعد بعيدًا عن نافذة التحذير', () => {
    expect(health(new Date('2026-03-01T00:00:00.000Z'))).toBe('GREEN')
  })

  it('أخضر عند اللحظة التي تسبق حدود نافذة التحذير مباشرة', () => {
    const boundary = new Date(DUE.getTime() - THRESHOLDS.amberDaysBeforeDue * DAY_MS)
    expect(health(new Date(boundary.getTime() - 1))).toBe('GREEN')
  })

  it('أصفر عند اللحظة التي تبدأ فيها نافذة التحذير تمامًا (الحد شامل)', () => {
    const boundary = new Date(DUE.getTime() - THRESHOLDS.amberDaysBeforeDue * DAY_MS)
    expect(health(boundary)).toBe('AMBER')
  })

  it('أصفر عند اللحظة التي تلي بداية نافذة التحذير بدقيقة', () => {
    const boundary = new Date(DUE.getTime() - THRESHOLDS.amberDaysBeforeDue * DAY_MS)
    expect(health(new Date(boundary.getTime() + 60_000))).toBe('AMBER')
  })

  it('أصفر عند لحظة الموعد النهائي بالضبط — لم يتجاوزه بعد', () => {
    expect(health(DUE)).toBe('AMBER')
  })

  it('أحمر بعد لحظة الموعد النهائي بدقيقة واحدة فقط', () => {
    expect(health(new Date(DUE.getTime() + 60_000))).toBe('RED')
  })

  it('أحمر بعيدًا بعد الموعد النهائي', () => {
    expect(health(new Date(DUE.getTime() + 30 * DAY_MS))).toBe('RED')
  })

  it('نافذة تحذير صفر: التحذير لا يظهر إلا عند لحظة الموعد ذاتها', () => {
    const zeroAmber: HealthThresholds = { ...THRESHOLDS, amberDaysBeforeDue: 0 }
    expect(health(new Date(DUE.getTime() - 60_000), { thresholds: zeroAmber })).toBe(
      'GREEN',
    )
    expect(health(DUE, { thresholds: zeroAmber })).toBe('AMBER')
    expect(health(new Date(DUE.getTime() + 1), { thresholds: zeroAmber })).toBe('RED')
  })
})

describe('computeProjectHealth — إشارات المهام (سيصير حيًا في المرحلة 4)', () => {
  it('يتجاوز عتبة المهام المتأخرة فيتحول أحمر حتى مع بعد الموعد', () => {
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 4, maxBlockedDays: 0, adminEscalationCount: 0 },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('RED')
  })

  it('عند العتبة تمامًا (لا تتجاوزها) لا يُحتسب أحمر بسبب المهام', () => {
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: {
        overdueTaskCount: THRESHOLDS.overdueTasksThreshold,
        maxBlockedDays: 0,
        adminEscalationCount: 0,
      },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('GREEN')
  })

  it('يتجاوز عتبة أيام التوقف فيتحول أحمر', () => {
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 0, maxBlockedDays: 4, adminEscalationCount: 0 },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('RED')
  })

  it('عتبة صفر مع إشارة واحدة فقط تكفي لتفعيل الأحمر', () => {
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 1, maxBlockedDays: 0, adminEscalationCount: 0 },
      thresholds: { ...THRESHOLDS, overdueTasksThreshold: 0 },
    })
    expect(result).toBe('RED')
  })

  it('مهمة واحدة مُصعَّدة للإدارة تكفي لفرض الأحمر (المرحلة 6)', () => {
    // "M days → notify admin + force project health RED". One is enough: the
    // threshold was already crossed when the level was written.
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 0, maxBlockedDays: 0, adminEscalationCount: 1 },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('RED')
  })

  it('التصعيد لمدير المشروع وحده لا يفرض الأحمر', () => {
    // Only ADMIN-level escalation counts here; `adminEscalationCount` is
    // literally a count of tasks at that level, so a PM escalation leaves it
    // at zero and the project stays where the other signals put it.
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2027-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 0, maxBlockedDays: 0, adminEscalationCount: 0 },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('GREEN')
  })
})

describe('computeProjectHealth — الحالات النهائية', () => {
  it.each([...TERMINAL_PROJECT_STATUSES])(
    'أخضر دائمًا لمشروع بحالة %s حتى لو تجاوز الموعد أو تجاوزت إشاراته العتبات',
    (status) => {
      const result = computeProjectHealth({
        status,
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
        now: new Date('2026-01-01T00:00:00.000Z'),
        signals: { overdueTaskCount: 999, maxBlockedDays: 999, adminEscalationCount: 0 },
        thresholds: THRESHOLDS,
      })
      expect(result).toBe('GREEN')
    },
  )

  it('حالة نشطة بنفس المدخلات المتطرفة تصير حمراء', () => {
    const result = computeProjectHealth({
      status: 'ACTIVE',
      dueDate: new Date('2020-01-01T00:00:00.000Z'),
      now: new Date('2026-01-01T00:00:00.000Z'),
      signals: { overdueTaskCount: 999, maxBlockedDays: 999, adminEscalationCount: 0 },
      thresholds: THRESHOLDS,
    })
    expect(result).toBe('RED')
  })
})

describe('effectiveProjectHealth — التقدير اليدوي مقابل المحتسب', () => {
  it('يعرض القيمة المحتسبة حين لا يوجد تقدير يدوي', () => {
    const effective = effectiveProjectHealth('GREEN', null, null)
    expect(effective).toEqual({
      health: 'GREEN',
      computed: 'GREEN',
      overridden: false,
      reason: null,
    })
  })

  it('يغلّب التقدير اليدوي على المحتسب ويحمل السبب', () => {
    const effective = effectiveProjectHealth(
      'RED',
      'GREEN',
      'تم الاتفاق مع العميل على تمديد غير رسمي',
    )
    expect(effective).toEqual({
      health: 'GREEN',
      computed: 'RED',
      overridden: true,
      reason: 'تم الاتفاق مع العميل على تمديد غير رسمي',
    })
  })

  it('يعيد أصل الاحتساب متاحًا حتى بعد التجاوز', () => {
    const effective = effectiveProjectHealth('RED', 'AMBER', 'سبب')
    expect(effective.computed).toBe('RED')
    expect(effective.health).toBe('AMBER')
  })
})
