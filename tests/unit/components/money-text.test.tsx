// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { MoneyText } from '@/components/data/money-text'
import { render, screen } from '@tests/helpers/render'

/**
 * `MoneyText` is the only way money reaches a screen in this product, so these
 * are not styling assertions.
 *
 * The one that matters most is the bidi isolation. Arabic is RTL; a number is
 * LTR; and a minus sign in a mixed run is placed by the bidirectional
 * algorithm, not by the string. Without `dir="ltr"` on an isolated element,
 * `-1,250.00` renders as `1,250.00-` — a deduction that reads as a credit, in
 * the product whose entire promise is that the money is explainable
 * (CLAUDE.md).
 */

describe('MoneyText', () => {
  it('يعرض المبلغ بأرقام غربية وفاصلة آلاف وخانتين عشريتين', () => {
    render(<MoneyText value="1234.5" />)
    expect(screen.getByText('1,234.50')).toBeInTheDocument()
  })

  it('لا يستخدم الأرقام العربية-الهندية', () => {
    // SPEC §2: Western numerals, even inside Arabic text.
    const { container } = render(<MoneyText value="1234.5" />)
    expect(container.textContent).not.toMatch(/[٠-٩]/)
  })

  it('يعزل الاتجاه إلى LTR فلا ينقلب موضع الإشارة السالبة', () => {
    render(<MoneyText value="-1250" />)
    const element = screen.getByText('-1,250.00')

    expect(element).toHaveAttribute('dir', 'ltr')
    expect(element).toHaveClass('numeric-latn')
  })

  it('يستخدم أرقامًا جدولية حتى تتحاذى الأعمدة', () => {
    // `.numeric-latn` carries `font-variant-numeric: tabular-nums`. Without it
    // a ledger's decimal points wander and two rows cannot be compared by eye.
    render(<MoneyText value="10" />)
    expect(screen.getByText('10.00')).toHaveClass('numeric-latn')
  })

  it('يضيف رمز العملة عند الطلب فقط', () => {
    const { container: plain } = render(<MoneyText value="1234.5" />)
    expect(plain.textContent).toBe('1,234.50')

    const { container: withCurrency } = render(<MoneyText value="1234.5" withCurrency />)
    expect(withCurrency.textContent).toContain('1,234.50')
    expect(withCurrency.textContent!.length).toBeGreaterThan('1,234.50'.length)
  })

  it('يُظهر إشارة الموجب عند الطلب', () => {
    render(<MoneyText value="250" signed />)
    expect(screen.getByText('+250.00')).toBeInTheDocument()
  })

  it('لا يلوّن المبالغ العادية إطلاقًا', () => {
    // Colour encodes data (SPEC §9). A salary is not a direction of money, so
    // it gets no hue.
    render(<MoneyText value="-500" data-testid="plain" />)
    expect(screen.getByTestId('plain')).not.toHaveAttribute('data-hue')
  })

  it('يلوّن قيود الحركات المالية باتجاه المبلغ', () => {
    // In a ledger the *direction* of the money is the fact being read, so here
    // the sign is a datum and earns a hue.
    render(
      <>
        <MoneyText value="-500" tone="ledger" data-testid="debit" />
        <MoneyText value="500" tone="ledger" data-testid="credit" />
        <MoneyText value="0" tone="ledger" data-testid="zero" />
      </>,
    )

    expect(screen.getByTestId('debit')).toHaveAttribute('data-hue', 'red')
    expect(screen.getByTestId('credit')).toHaveAttribute('data-hue', 'emerald')
    expect(screen.getByTestId('zero')).not.toHaveAttribute('data-hue')
  })

  it('نمط الحركات المالية يُظهر الإشارة تلقائيًا', () => {
    render(<MoneyText value="500" tone="ledger" />)
    expect(screen.getByText('+500.00')).toBeInTheDocument()
  })

  it('يقرّب إلى خانتين عشريتين بطريقة HALF_UP', () => {
    render(<MoneyText value="2.345" />)
    expect(screen.getByText('2.35')).toBeInTheDocument()
  })

  it('يقبل النص والرقم على السواء لأن المال يعبر الحدود كنص', () => {
    const { container: fromString } = render(<MoneyText value="1500.00" />)
    const { container: fromNumber } = render(<MoneyText value={1500} />)
    expect(fromString.textContent).toBe(fromNumber.textContent)
  })
})
