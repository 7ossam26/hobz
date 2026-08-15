import { describe, expect, it } from 'vitest'

import { DomainError } from '@/lib/errors'
import { MONEY_MAX } from '@/lib/money'
import {
  LEDGER_TYPES,
  assertSignForType,
  isCredit,
  isDebit,
  signOf,
  signedAmountFor,
} from '@/modules/ledger/sign'

/**
 * The sign convention is the reason every balance in this product is a plain
 * `SUM(amount)` (SPEC §4). If a `PENALTY` could be stored positive, every query
 * that adds up money would need to know which types to subtract — and the first
 * one that forgot would pay somebody their own deduction.
 *
 * Credits to the منفّذ are positive. Debits are negative. Two types are signed
 * by their own content rather than by their name.
 */

describe('modules/ledger/sign — اتجاه كل نوع', () => {
  it('الاستحقاق والراتب والمكافأة دائنة', () => {
    for (const type of ['EARNING', 'SALARY', 'BONUS'] as const) {
      expect(signOf(type)).toBe('credit')
      expect(isCredit(type)).toBe(true)
      expect(isDebit(type)).toBe(false)
    }
  })

  it('الخصم والسلفة والصرف مدينة', () => {
    for (const type of ['PENALTY', 'ADVANCE', 'PAYOUT'] as const) {
      expect(signOf(type)).toBe('debit')
      expect(isDebit(type)).toBe(true)
      expect(isCredit(type)).toBe(false)
    }
  })

  it('التسوية وعكس القيد يحملان الإشارتين', () => {
    // An ADJUSTMENT can credit (pay a previous assignee, SPEC M4) or debit.
    // A REVERSAL always carries the opposite sign of what it reverses.
    for (const type of ['ADJUSTMENT', 'REVERSAL'] as const) {
      expect(signOf(type)).toBe('either')
      expect(isCredit(type)).toBe(false)
      expect(isDebit(type)).toBe(false)
    }
  })

  it('يغطي كل قيم LedgerEntryType بلا استثناء', () => {
    // A new type added to the Prisma enum without a rule here would default to
    // whatever the lookup returns for `undefined` — silently unconstrained.
    expect(LEDGER_TYPES).toHaveLength(8)
    for (const type of LEDGER_TYPES) {
      expect(['credit', 'debit', 'either']).toContain(signOf(type))
    }
  })
})

describe('modules/ledger/sign — التحقق قبل الكتابة', () => {
  it('يقبل المبلغ الموجب للأنواع الدائنة ويرفض السالب', () => {
    expect(() => assertSignForType('EARNING', '500.00')).not.toThrow()
    expect(() => assertSignForType('EARNING', '-500.00')).toThrow(DomainError)
    expect(() => assertSignForType('SALARY', '-1.00')).toThrow(DomainError)
    expect(() => assertSignForType('BONUS', '-0.01')).toThrow(DomainError)
  })

  it('يقبل المبلغ السالب للأنواع المدينة ويرفض الموجب', () => {
    expect(() => assertSignForType('PENALTY', '-250.00')).not.toThrow()
    expect(() => assertSignForType('PENALTY', '250.00')).toThrow(DomainError)
    expect(() => assertSignForType('ADVANCE', '3000.00')).toThrow(DomainError)
    expect(() => assertSignForType('PAYOUT', '0.01')).toThrow(DomainError)
  })

  it('يقبل الاتجاهين للتسوية', () => {
    expect(() => assertSignForType('ADJUSTMENT', '300.00')).not.toThrow()
    expect(() => assertSignForType('ADJUSTMENT', '-300.00')).not.toThrow()
  })

  it('يرفض الصفر لكل الأنواع — القيد الذي لا يحرّك مالًا ليس حركة', () => {
    for (const type of LEDGER_TYPES) {
      expect(() => assertSignForType(type, '0.00'), type).toThrow(DomainError)
      expect(() => assertSignForType(type, '-0.00'), type).toThrow(DomainError)
    }
  })

  it('يرفض ما لا يتّسع في العمود Decimal(12,2)', () => {
    expect(() => assertSignForType('EARNING', MONEY_MAX.plus(1))).toThrow(DomainError)
    expect(() => assertSignForType('PENALTY', MONEY_MAX.plus(1).negated())).toThrow(
      DomainError,
    )
    expect(() => assertSignForType('EARNING', MONEY_MAX)).not.toThrow()
  })

  it('يرفض الكسور التي تتجاوز خانتين — لا تقريب صامت', () => {
    // Rounding here would let 0.005 vanish from one entry and reappear as a
    // rounding error in a balance nobody can explain.
    expect(() => assertSignForType('EARNING', '10.005')).toThrow(DomainError)
    expect(() => assertSignForType('EARNING', '10.01')).not.toThrow()
  })
})

describe('modules/ledger/sign — تطبيق الإشارة', () => {
  it('يحوّل المقدار المُدخل إلى مبلغ موقّع حسب النوع', () => {
    // The سلفة form asks for "٣٠٠٠"; the ledger stores −3000.00.
    expect(signedAmountFor('ADVANCE', '3000.00')).toBe('-3000.00')
    expect(signedAmountFor('PENALTY', '250.50')).toBe('-250.50')
    expect(signedAmountFor('EARNING', '500.00')).toBe('500.00')
    expect(signedAmountFor('BONUS', '1000.00')).toBe('1000.00')
  })

  it('يرفض مقدارًا سالبًا أو صفرًا كمُدخل', () => {
    expect(() => signedAmountFor('ADVANCE', '-3000.00')).toThrow(DomainError)
    expect(() => signedAmountFor('EARNING', '0.00')).toThrow(DomainError)
  })

  it('لا يقبل نوعًا ذا اتجاهين — التسوية تُكتب بمبلغ موقّع صراحةً', () => {
    expect(() => signedAmountFor('ADJUSTMENT', '300.00')).toThrow(DomainError)
    expect(() => signedAmountFor('REVERSAL', '300.00')).toThrow(DomainError)
  })
})
