import { describe, expect, it } from 'vitest'

import { computeUtilisation } from '@/modules/workload/service'

/**
 * Phase 10 phase brief: "utilisation = Σ estimatedHours of active tasks ÷
 * weeklyCapacityHours". docs/TESTING.md §4 axis 1 (boundaries) and axis 12
 * (empty/null).
 */
describe('computeUtilisation — حساب نسبة الإشغال', () => {
  it('صفر ساعات نشطة تعني إشغالًا صفريًا', () => {
    const result = computeUtilisation({ activeEstimatedHours: 0, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBe(0)
    expect(result.overCapacity).toBe(false)
  })

  it('نصف الطاقة بالضبط', () => {
    const result = computeUtilisation({ activeEstimatedHours: 20, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBe(50)
    expect(result.overCapacity).toBe(false)
  })

  it('عند الطاقة بالضبط — ١٠٠٪ وليس تجاوزًا', () => {
    const result = computeUtilisation({ activeEstimatedHours: 40, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBe(100)
    expect(result.overCapacity).toBe(false)
  })

  it('أول ساعة تتجاوز الطاقة تُحتسب تجاوزًا', () => {
    const result = computeUtilisation({ activeEstimatedHours: 41, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBeGreaterThan(100)
    expect(result.overCapacity).toBe(true)
  })

  it('تجاوز كبير للطاقة', () => {
    const result = computeUtilisation({ activeEstimatedHours: 80, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBe(200)
    expect(result.overCapacity).toBe(true)
  })

  it('يقرّب لأقرب عُشر', () => {
    const result = computeUtilisation({ activeEstimatedHours: 13, weeklyCapacityHours: 40 })
    expect(result.utilisationPercent).toBe(32.5)
  })

  it('طاقة صفرية بلا ساعات نشطة تُحتسب صفرًا لا خطأ قسمة على صفر', () => {
    const result = computeUtilisation({ activeEstimatedHours: 0, weeklyCapacityHours: 0 })
    expect(result.utilisationPercent).toBe(0)
    expect(result.overCapacity).toBe(false)
    expect(Number.isFinite(result.utilisationPercent)).toBe(true)
  })

  it('الحد الأقصى لساعات العمل الأسبوعية (١٦٨ ساعة) لا يكسر الحساب', () => {
    const result = computeUtilisation({ activeEstimatedHours: 168, weeklyCapacityHours: 168 })
    expect(result.utilisationPercent).toBe(100)
  })
})
