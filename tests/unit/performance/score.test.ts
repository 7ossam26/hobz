import { describe, expect, it } from 'vitest'

import {
  computePerformanceScore,
  type PerformanceWeights,
  type TaskPerformanceFact,
} from '@/modules/performance/service'

/**
 * SPEC §5.6: on-time 50% / quality 30% / volume 10% / estimate accuracy 10%.
 * docs/PHASES.md Phase 10: "performance score maths at boundaries (no tasks,
 * all late, all on time)". docs/TESTING.md §4 axis 1 (boundaries) and axis 12
 * (empty/null).
 */

const DEFAULT_WEIGHTS: PerformanceWeights = {
  onTime: 50,
  quality: 30,
  volume: 10,
  estimateAccuracy: 10,
}

function fact(overrides: Partial<TaskPerformanceFact> = {}): TaskPerformanceFact {
  return {
    onTime: true,
    qualityRating: 5,
    estimatedHours: 8,
    actualWorkingHours: 8,
    ...overrides,
  }
}

describe('computePerformanceScore — لا توجد مهام', () => {
  it('صفر في كل عنصر ولا خطأ قسمة على صفر', () => {
    const result = computePerformanceScore([], 0, DEFAULT_WEIGHTS)
    expect(result).toEqual({
      score: 0,
      onTimeRate: 0,
      qualityScore: 0,
      volumeScore: 0,
      estimateAccuracy: 0,
      taskCount: 0,
    })
  })
})

describe('computePerformanceScore — الالتزام بالمواعيد', () => {
  it('كل المهام متأخرة: الالتزام صفر', () => {
    const facts = [
      fact({ onTime: false }),
      fact({ onTime: false }),
      fact({ onTime: false }),
    ]
    const result = computePerformanceScore(facts, 3, DEFAULT_WEIGHTS)
    expect(result.onTimeRate).toBe(0)
    // Quality/volume/estimate stay at their own values — a late delivery does
    // not zero the other components (SPEC §5.6 weights them independently).
    expect(result.qualityScore).toBe(100)
    expect(result.volumeScore).toBe(100)
    expect(result.estimateAccuracy).toBe(100)
    // score = 0*50 + 100*30 + 100*10 + 100*10, over weight sum 100
    expect(result.score).toBe(50)
  })

  it('كل المهام في الموعد: الالتزام ١٠٠٪', () => {
    const facts = [fact(), fact(), fact()]
    const result = computePerformanceScore(facts, 3, DEFAULT_WEIGHTS)
    expect(result.onTimeRate).toBe(100)
    expect(result.score).toBe(100)
  })

  it('نصف المهام في الموعد', () => {
    const facts = [fact({ onTime: true }), fact({ onTime: false })]
    const result = computePerformanceScore(facts, 2, DEFAULT_WEIGHTS)
    expect(result.onTimeRate).toBe(50)
  })
})

describe('computePerformanceScore — تقييم الجودة', () => {
  it('بلا أي تقييم مسجَّل: الجودة صفر', () => {
    const facts = [fact({ qualityRating: null }), fact({ qualityRating: null })]
    const result = computePerformanceScore(facts, 2, DEFAULT_WEIGHTS)
    expect(result.qualityScore).toBe(0)
  })

  it('التقييم الأدنى (١) يعطي صفرًا بعد إعادة القياس', () => {
    const result = computePerformanceScore(
      [fact({ qualityRating: 1 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.qualityScore).toBe(0)
  })

  it('التقييم الأعلى (٥) يعطي ١٠٠', () => {
    const result = computePerformanceScore(
      [fact({ qualityRating: 5 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.qualityScore).toBe(100)
  })

  it('تقييم متوسط (٣) يعطي منتصف المقياس', () => {
    const result = computePerformanceScore(
      [fact({ qualityRating: 3 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.qualityScore).toBe(50)
  })

  it('المهام بلا تقييم مستبعَدة من المتوسط، لا مُحتسَبة صفرًا', () => {
    const facts = [fact({ qualityRating: 5 }), fact({ qualityRating: null })]
    const result = computePerformanceScore(facts, 2, DEFAULT_WEIGHTS)
    // Average of the *one* rated task (5), not (5+0)/2.
    expect(result.qualityScore).toBe(100)
  })
})

describe('computePerformanceScore — حجم الإنجاز مقارنة بالزملاء', () => {
  it('صاحب أعلى حجم إنجاز يحصل على ١٠٠', () => {
    const facts = [fact(), fact(), fact()]
    const result = computePerformanceScore(facts, 3, DEFAULT_WEIGHTS)
    expect(result.volumeScore).toBe(100)
  })

  it('نصف حجم الأعلى إنجازًا', () => {
    const facts = [fact(), fact()]
    const result = computePerformanceScore(facts, 4, DEFAULT_WEIGHTS)
    expect(result.volumeScore).toBe(50)
  })

  it('لا يتجاوز ١٠٠ حتى لو تجاوز الحد الأقصى المُمرَّر خطأً', () => {
    const facts = [fact(), fact()]
    const result = computePerformanceScore(facts, 1, DEFAULT_WEIGHTS)
    expect(result.volumeScore).toBe(100)
  })

  it('حد أقصى صفري مع مهام منجزة: يُحتسب ١٠٠ دون خطأ قسمة على صفر', () => {
    const result = computePerformanceScore([fact()], 0, DEFAULT_WEIGHTS)
    expect(result.volumeScore).toBe(100)
  })
})

describe('computePerformanceScore — دقة التقدير', () => {
  it('تطابق تام بين التقدير والفعلي: ١٠٠', () => {
    const result = computePerformanceScore(
      [fact({ estimatedHours: 10, actualWorkingHours: 10 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.estimateAccuracy).toBe(100)
  })

  it('انحراف بمقدار الربع يُنقص ٢٥ نقطة', () => {
    const result = computePerformanceScore(
      [fact({ estimatedHours: 10, actualWorkingHours: 12.5 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.estimateAccuracy).toBe(75)
  })

  it('انحراف كبير جدًا لا يقل عن صفر (لا قيمة سالبة)', () => {
    const result = computePerformanceScore(
      [fact({ estimatedHours: 10, actualWorkingHours: 1000 })],
      1,
      DEFAULT_WEIGHTS,
    )
    expect(result.estimateAccuracy).toBe(0)
  })

  it('مهمة بلا تقدير مسجَّل (صفر ساعات) مستبعدة من الحساب', () => {
    const facts = [
      fact({ estimatedHours: 0, actualWorkingHours: 5 }),
      fact({ estimatedHours: 10, actualWorkingHours: 10 }),
    ]
    const result = computePerformanceScore(facts, 2, DEFAULT_WEIGHTS)
    expect(result.estimateAccuracy).toBe(100)
  })

  it('كل المهام بلا تقدير: الدقة صفر', () => {
    const facts = [fact({ estimatedHours: 0 }), fact({ estimatedHours: 0 })]
    const result = computePerformanceScore(facts, 2, DEFAULT_WEIGHTS)
    expect(result.estimateAccuracy).toBe(0)
  })
})

describe('computePerformanceScore — الوزن الإجمالي', () => {
  it('أوزان لا تجمع إلى ١٠٠: يُقسَّم على مجموعها الفعلي فيبقى الناتج بين ٠ و١٠٠', () => {
    const skewed: PerformanceWeights = {
      onTime: 90,
      quality: 90,
      volume: 0,
      estimateAccuracy: 0,
    }
    const result = computePerformanceScore([fact()], 1, skewed)
    expect(result.score).toBe(100)
  })

  it('كل الأوزان صفر: لا خطأ قسمة على صفر، والنتيجة صفر', () => {
    const zero: PerformanceWeights = {
      onTime: 0,
      quality: 0,
      volume: 0,
      estimateAccuracy: 0,
    }
    const result = computePerformanceScore([fact()], 1, zero)
    expect(result.score).toBe(0)
  })

  it('وزن واحد فقط فعّال: النتيجة تساوي عنصره فقط', () => {
    const onlyQuality: PerformanceWeights = {
      onTime: 0,
      quality: 100,
      volume: 0,
      estimateAccuracy: 0,
    }
    const result = computePerformanceScore(
      [fact({ onTime: false, qualityRating: 5 })],
      1,
      onlyQuality,
    )
    expect(result.score).toBe(100)
  })
})

describe('computePerformanceScore — عدد المهام', () => {
  it('يعكس عدد المهام المدخلة بالضبط', () => {
    const result = computePerformanceScore([fact(), fact(), fact()], 3, DEFAULT_WEIGHTS)
    expect(result.taskCount).toBe(3)
  })
})
