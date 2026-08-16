import { describe, expect, it } from 'vitest'

import { SETTINGS_CATALOG } from '@/lib/settings/catalog'
import {
  resolveGraceHours,
  resolvePenalizeRevisionLateness,
  resolvePenaltyProfile,
  type PenaltyDefaults,
} from '@/modules/penalty/profile'

/**
 * SPEC §5.4: `profile = user.penaltyProfile ?? settings.defaultPenaltyProfile`,
 * and SPEC §5.3: "Grace: project override → global default."
 *
 * Defaults are read from the catalog rather than written as literals
 * (docs/TESTING.md §5: "never assert on a hardcoded business number; read it
 * from Settings in the test too, so a Settings change doesn't silently break
 * the suite's meaning"). What the tests below pin is the *shape of the
 * resolution* — which source wins — not the numbers themselves.
 */

const DEFAULTS: PenaltyDefaults = {
  mode: SETTINGS_CATALOG['penalty.defaultMode'].default,
  value: SETTINGS_CATALOG['penalty.defaultValue'].default,
  graceHours: SETTINGS_CATALOG['penalty.defaultGraceHours'].default,
}

const GLOBAL_PENALIZE_REVISIONS =
  SETTINGS_CATALOG['penalty.penalizeRevisionLateness'].default

describe('resolvePenaltyProfile — الافتراضي العام ثم تجاوز المنفّذ', () => {
  it('بلا بروفايل: إعدادات الوكالة، ويُقال إنها الافتراضي', () => {
    const resolved = resolvePenaltyProfile(null, DEFAULTS)

    expect(resolved.mode).toBe(DEFAULTS.mode)
    expect(resolved.value).toBe(`${DEFAULTS.value.toFixed(2)}`)
    expect(resolved.profileId).toBeNull()
    expect(resolved.profileName).toBeNull()
  })

  it('ببروفايل: البروفايل يفوز بالكامل — الوضع والقيمة معًا', () => {
    const resolved = resolvePenaltyProfile(
      {
        id: 'prof_1',
        name: 'خصم المصممين',
        mode: 'FIXED_PER_DAY',
        value: '75.00',
        graceHours: 8,
      },
      DEFAULTS,
    )

    expect(resolved.mode).toBe('FIXED_PER_DAY')
    expect(resolved.value).toBe('75.00')
    expect(resolved.profileId).toBe('prof_1')
    expect(resolved.profileName).toBe('خصم المصممين')
  })

  /**
   * A profile is a *bundle*. Taking its mode but the agency's value would
   * produce a formula nobody configured — "150% of the task value per day",
   * from a profile that said 150 EGP and a default that said percent.
   */
  it('لا يخلط: قيمة البروفايل لا تُقرأ مع وضع الإعدادات', () => {
    const resolved = resolvePenaltyProfile(
      { id: 'p', name: 'ن', mode: 'FIXED_ONCE', value: '150.00', graceHours: null },
      { mode: 'PCT_TASK_VALUE_PER_DAY', value: 5, graceHours: 24 },
    )

    expect(resolved.mode).toBe('FIXED_ONCE')
    expect(resolved.value).toBe('150.00')
  })

  /**
   * Unreachable through Prisma — the column is an enum — but this function is
   * also the seam an `.xlsx` import or a hand-repaired row reaches. Falling back
   * to the agency default would apply a formula nobody chose to somebody's pay,
   * quietly and forever; throwing makes the bad row somebody's problem today.
   */
  it('وضع غير معروف يرمي خطأً بدل أن يسقط للافتراضي', () => {
    expect(() =>
      resolvePenaltyProfile(
        {
          id: 'p',
          name: 'مستورد بعطب',
          mode: 'PCT_OF_WHATEVER',
          value: '5.00',
          graceHours: null,
        },
        DEFAULTS,
      ),
    ).toThrow(RangeError)
  })

  it('يقبل قيمة Decimal كما تصل من Prisma', () => {
    // Prisma hands back a `Decimal`, not a string. The profile is read straight
    // off the row in `assess.ts`, so the coercion has to work on both.
    const resolved = resolvePenaltyProfile(
      {
        id: 'p',
        name: 'ديسيمال',
        mode: 'FIXED_ONCE',
        value: { toFixed: (dp: number) => (120).toFixed(dp) },
        graceHours: null,
      },
      DEFAULTS,
    )

    expect(resolved.value).toBe('120.00')
  })

  it('قيمة صفر في البروفايل قرار، لا نقص بيانات', () => {
    const resolved = resolvePenaltyProfile(
      {
        id: 'p',
        name: 'بلا خصم',
        mode: 'FIXED_PER_DAY',
        value: '0.00',
        graceHours: null,
      },
      DEFAULTS,
    )

    expect(resolved.value).toBe('0.00')
  })
})

describe('resolveGraceHours — المشروع ثم البروفايل ثم العام', () => {
  it('لا تجاوز في أي موضع: مهلة الوكالة', () => {
    expect(
      resolveGraceHours({
        projectOverride: null,
        profileOverride: null,
        globalDefault: DEFAULTS.graceHours,
      }),
    ).toBe(DEFAULTS.graceHours)
  })

  it('بروفايل المنفّذ يتجاوز العام', () => {
    expect(
      resolveGraceHours({
        projectOverride: null,
        profileOverride: 8,
        globalDefault: DEFAULTS.graceHours,
      }),
    ).toBe(8)
  })

  /**
   * The project is the narrower promise — it is a commitment made to a client
   * about *this work* — so it outranks a commitment made to a person. SPEC
   * §5.3's "project override → global default" stays literally true whenever a
   * project has set one; the profile fills the gap where it has not.
   */
  it('تجاوز المشروع يفوز على بروفايل المنفّذ', () => {
    expect(
      resolveGraceHours({ projectOverride: 2, profileOverride: 8, globalDefault: 24 }),
    ).toBe(2)
  })

  it('صفر قرار وليس غيابًا — في المشروع', () => {
    // `??` and never `||`: a project configured with zero grace has decided
    // that this client accepts no slippage, and `||` would silently restore the
    // agency's 24 hours.
    expect(
      resolveGraceHours({ projectOverride: 0, profileOverride: 8, globalDefault: 24 }),
    ).toBe(0)
  })

  it('صفر قرار وليس غيابًا — في البروفايل', () => {
    expect(
      resolveGraceHours({ projectOverride: null, profileOverride: 0, globalDefault: 24 }),
    ).toBe(0)
  })

  it('يتعامل مع undefined كما يتعامل مع null', () => {
    expect(
      resolveGraceHours({
        projectOverride: undefined,
        profileOverride: undefined,
        globalDefault: 24,
      }),
    ).toBe(24)
  })
})

describe('resolvePenalizeRevisionLateness — SPEC T4', () => {
  it('الافتراضي من الإعدادات حين لا يقرر المشروع', () => {
    expect(resolvePenalizeRevisionLateness(null, GLOBAL_PENALIZE_REVISIONS)).toBe(
      GLOBAL_PENALIZE_REVISIONS,
    )
  })

  it('المشروع يطفئها صراحةً', () => {
    expect(resolvePenalizeRevisionLateness(false, true)).toBe(false)
  })

  it('المشروع يشغّلها صراحةً رغم إطفائها عامًا', () => {
    // `??`, not `||`: `false` is a decision. This is the same trap the grace
    // chain avoids, and a boolean is where `||` bites hardest.
    expect(resolvePenalizeRevisionLateness(true, false)).toBe(true)
  })
})
