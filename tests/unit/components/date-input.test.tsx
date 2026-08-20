// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Sheet } from '@/components/shared/sheet'
import {
  DateInput,
  DateTimeInput,
  formatDateInputDisplay,
  formatDateTimeInputDisplay,
} from '@/components/ui/date-input'
import { fireEvent, render, screen } from '@tests/helpers/render'

/**
 * The manual-QA bug: "the date picker sometimes opens when clicked and
 * sometimes does not".
 *
 * jsdom implements neither the native calendar nor `showPicker`, so these
 * assert the three decisions that make the field deterministic in a real
 * browser rather than trying to observe a popup that cannot exist here.
 */

/** jsdom has no `showPicker`; install a spy the component can find. */
function withShowPicker(): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
    configurable: true,
    writable: true,
    value: spy,
  })
  return spy
}

describe('DateInput', () => {
  it('يحتفظ بحقل التاريخ الأصلي كصاحب القيمة والمنتقي', () => {
    render(<DateInput aria-label="تاريخ" />)
    expect(screen.getByLabelText('تاريخ')).toHaveAttribute('type', 'date')
  })

  it('يثبّت الاتجاه على ltr رغم أن الصفحة عربية', () => {
    // Under the document's `dir="rtl"` Blink renders the calendar indicator at
    // the inline end — the left edge — where nobody looks for it.
    render(<DateInput aria-label="تاريخ" />)
    expect(screen.getByLabelText('تاريخ')).toHaveAttribute('dir', 'ltr')
  })

  it('لا يسمح للحقل بالانكماش تحت عرضه الأدنى', () => {
    // `Input` carries `min-w-0`, which let a two-column sheet squeeze the field
    // until the indicator was clipped out of the box entirely.
    const wrapper = render(<DateInput aria-label="تاريخ" />).container.querySelector(
      '[data-slot="picker-input"]',
    )
    expect(wrapper?.className).toContain('min-w-[9.5rem]')
  })

  it('النقر في أي موضع يفتح المنتقي', () => {
    const showPicker = withShowPicker()
    render(<DateInput aria-label="تاريخ" />)

    fireEvent.click(screen.getByLabelText('تاريخ'))

    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('التركيز وحده لا يفتح المنتقي', () => {
    // The regression this guards: `use-modal.ts` focuses the first control in a
    // sheet's body when it opens. Binding `showPicker` to focus would pop a
    // calendar nobody asked for on every such open, and again on every
    // programmatic refocus.
    const showPicker = withShowPicker()
    render(<DateInput aria-label="تاريخ" />)

    screen.getByLabelText('تاريخ').focus()
    fireEvent.focus(screen.getByLabelText('تاريخ'))

    expect(showPicker).not.toHaveBeenCalled()
  })

  it('فتح لوحة تحمل حقل تاريخ أولًا لا يفتح المنتقي', () => {
    // The same guard, through the real modal: the sheet autofocuses its first
    // body control, which here *is* the date field.
    const showPicker = withShowPicker()
    render(
      <Sheet open onClose={() => {}} title="لوحة">
        <DateInput aria-label="تاريخ" />
      </Sheet>,
    )

    expect(screen.getByLabelText('تاريخ')).toHaveFocus()
    expect(showPicker).not.toHaveBeenCalled()
  })

  it('لا ينكسر حين لا يدعم المتصفح showPicker', () => {
    // Older Safari has no `showPicker`; `NotAllowedError` is thrown when the
    // click did not count as user activation. Either way the native indicator
    // still works, so the field must not throw.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('NotAllowedError')
      },
    })
    render(<DateInput aria-label="تاريخ" />)

    expect(() => fireEvent.click(screen.getByLabelText('تاريخ'))).not.toThrow()
  })

  it('يحترم onClick الخاص بالمستدعي ويتوقف عند preventDefault', () => {
    const showPicker = withShowPicker()
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault())
    render(<DateInput aria-label="تاريخ" onClick={onClick} />)

    fireEvent.click(screen.getByLabelText('تاريخ'))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(showPicker).not.toHaveBeenCalled()
  })

  it('يمرّر القيمة والتغيير كحقل مضبوط', () => {
    const onChange = vi.fn()
    render(<DateInput aria-label="تاريخ" value="2026-08-19" onChange={onChange} />)

    const input = screen.getByLabelText('تاريخ') as HTMLInputElement
    expect(input.value).toBe('2026-08-19')

    fireEvent.change(input, { target: { value: '2026-09-01' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('يعرض dd/mm/yyyy مع إبقاء قيمة ISO في الحقل', () => {
    render(<DateInput aria-label="تاريخ" value="2026-08-19" readOnly />)

    expect(screen.getByText('19/08/2026')).toBeInTheDocument()
    expect(screen.getByLabelText('تاريخ')).toHaveValue('2026-08-19')
  })

  it('يعرض placeholder ثابتًا حين تكون القيمة فارغة', () => {
    render(<DateInput aria-label="تاريخ" value="" readOnly />)
    expect(screen.getByText('dd/mm/yyyy')).toBeInTheDocument()
  })

  it('يحدّث العرض في الحقل غير المضبوط مثل مرشحات التدقيق', () => {
    render(<DateInput aria-label="تاريخ" defaultValue="2026-08-19" />)

    fireEvent.change(screen.getByLabelText('تاريخ'), {
      target: { value: '2026-09-01' },
    })
    expect(screen.getByText('01/09/2026')).toBeInTheDocument()
  })
})

describe('DateTimeInput', () => {
  it('يعرض التاريخ والوقت بصيغة ثابتة ويحفظ قيمة datetime-local', () => {
    render(<DateTimeInput aria-label="موعد" value="2026-08-19T15:30" readOnly />)

    expect(screen.getByText('19/08/2026, 15:30')).toBeInTheDocument()
    expect(screen.getByLabelText('موعد')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('موعد')).toHaveValue('2026-08-19T15:30')
  })
})

describe('تنسيق حقول التاريخ', () => {
  it('لا يخمّن قيمة غير صالحة', () => {
    expect(formatDateInputDisplay('2026-8-1')).toBe('')
    expect(formatDateTimeInputDisplay('not-a-date')).toBe('')
  })
})

describe('حقول التاريخ في المنتج', () => {
  it('لا يوجد <input type="date"> خام خارج DateInput', async () => {
    // The drift this component exists to end: two screens had worked around the
    // RTL indicator locally with `dir="ltr"` and six had not. A grep is the
    // cheapest thing that keeps the next one from being written by hand.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const toPosix = (value: string): string =>
      value.split(String.fromCharCode(92)).join('/')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!full.endsWith('.tsx')) continue
        if (toPosix(full).endsWith('components/ui/date-input.tsx')) continue
        if (/type="date"/.test(readFileSync(full, 'utf8'))) {
          offenders.push(toPosix(full))
        }
      }
    }
    walk(join(process.cwd(), 'src'))

    expect(offenders).toEqual([])
  })

  it('لا يوجد <input type="datetime-local"> خام خارج DateTimeInput', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const toPosix = (value: string): string =>
      value.split(String.fromCharCode(92)).join('/')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!full.endsWith('.tsx')) continue
        if (toPosix(full).endsWith('components/ui/date-input.tsx')) continue
        if (/type="datetime-local"/.test(readFileSync(full, 'utf8'))) {
          offenders.push(toPosix(full))
        }
      }
    }
    walk(join(process.cwd(), 'src'))

    expect(offenders).toEqual([])
  })
})
