// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Sheet } from '@/components/shared/sheet'
import { DateInput } from '@/components/ui/date-input'
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
  it('هو حقل تاريخ أصلي — لم يُستبدل بمنتقٍ مخصّص', () => {
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
    const input = render(<DateInput aria-label="تاريخ" />).container.querySelector('input')
    expect(input?.className).toContain('min-w-[9.5rem]')
    expect(input?.className).not.toContain('min-w-0')
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
})

describe('حقول التاريخ في المنتج', () => {
  it('لا يوجد <input type="date"> خام خارج DateInput', async () => {
    // The drift this component exists to end: two screens had worked around the
    // RTL indicator locally with `dir="ltr"` and six had not. A grep is the
    // cheapest thing that keeps the next one from being written by hand.
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')

    const toPosix = (value: string): string => value.split(String.fromCharCode(92)).join('/')
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
})
