// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'


import { DateText, DateTimeText, DurationText } from '@/components/data/date-text'
import { ar } from '@/i18n/ar'
import { render, screen } from '@tests/helpers/render'

/**
 * Dates as a reader sees them: Gregorian calendar, Arabic month name, Western
 * digits, Cairo wall clock (SPEC §2).
 *
 * Two things are asserted beyond the wording. Every date is a `<time>` carrying
 * a machine-readable instant — which is what lets a later phase sort, export or
 * re-parse it without re-deriving the value from Arabic text. And a missing
 * date renders `لا يوجد` rather than an empty cell, because "no due date" is a
 * fact about a task and blank space is a rendering bug the reader has to
 * diagnose.
 */

/** 14 August 2026, 09:30 UTC → 12:30 Cairo. */
const INSTANT = new Date('2026-08-14T09:30:00.000Z')

describe('DateText', () => {
  it('يعرض التاريخ ميلاديًا باسم شهر عربي وأرقام غربية', () => {
    render(<DateText value={INSTANT} />)
    expect(screen.getByText(`14 ${ar.months[7]} 2026`)).toBeInTheDocument()
  })

  it('يستخدم عنصر time بقيمة قابلة للقراءة آليًا', () => {
    render(<DateText value={INSTANT} />)
    const element = screen.getByText(`14 ${ar.months[7]} 2026`)

    expect(element.tagName).toBe('TIME')
    expect(element).toHaveAttribute('dateTime', INSTANT.toISOString())
  })

  it('يحمل التاريخ والوقت الكاملين في التلميح', () => {
    render(<DateText value={INSTANT} />)
    expect(screen.getByText(`14 ${ar.months[7]} 2026`)).toHaveAttribute(
      'title',
      `14 ${ar.months[7]} 2026${ar.common.listSeparator}12:30`,
    )
  })

  it('الصيغة المختصرة تحذف السنة', () => {
    render(<DateText value={INSTANT} variant="short" />)
    expect(screen.getByText(`14 ${ar.months[7]}`)).toBeInTheDocument()
  })

  it('يعرض «لا يوجد» بدل خلية فارغة', () => {
    render(<DateText value={null} />)
    expect(screen.getByText(ar.common.none)).toBeInTheDocument()
  })

  it('يتعامل مع undefined كما يتعامل مع null', () => {
    render(<DateText value={undefined} />)
    expect(screen.getByText(ar.common.none)).toBeInTheDocument()
  })

  it('يعرض اليوم بتوقيت القاهرة لا بتوقيت UTC', () => {
    // 22:30 UTC on the 14th is already the 15th in Cairo. A deadline that
    // reads as a different day to the server and to the worker is a dispute.
    render(<DateText value={new Date('2026-08-14T22:30:00.000Z')} />)
    expect(screen.getByText(`15 ${ar.months[7]} 2026`)).toBeInTheDocument()
  })

  it('لا يستخدم الأرقام العربية-الهندية', () => {
    const { container } = render(<DateText value={INSTANT} />)
    expect(container.textContent).not.toMatch(/[٠-٩]/)
  })
})

describe('DateTimeText', () => {
  it('يعرض التاريخ والوقت بتوقيت القاهرة', () => {
    const { container } = render(<DateTimeText value={INSTANT} />)
    expect(container.textContent).toContain(`14 ${ar.months[7]} 2026`)
    expect(container.textContent).toContain('12:30')
  })

  it('يستخدم أرقامًا جدولية للوقت', () => {
    render(<DateTimeText value={INSTANT} />)
    expect(screen.getByText('12:30')).toHaveClass('tabular-nums')
  })

  it('يعرض «لا يوجد» عند غياب القيمة', () => {
    render(<DateTimeText value={null} />)
    expect(screen.getByText(ar.common.none)).toBeInTheDocument()
  })
})

describe('DurationText', () => {
  it('يعرض المدة بصيغة عربية صحيحة', () => {
    render(<DurationText minutes={195} />)
    expect(screen.getByText('3 ساعات و15 دقيقة')).toBeInTheDocument()
  })

  it('يستخدم المثنى لا «2 ساعة»', () => {
    render(<DurationText minutes={120} />)
    expect(screen.getByText('ساعتين')).toBeInTheDocument()
  })

  it('ليس عنصر time لأن المدة كمية لا لحظة', () => {
    render(<DurationText minutes={30} />)
    expect(screen.getByText('30 دقيقة').tagName).toBe('SPAN')
  })

  it('يميّز الصفر عن الغياب', () => {
    // Zero elapsed minutes is a measurement; a null is the absence of one.
    const { container } = render(<DurationText minutes={0} />)
    expect(container.textContent).toBe('0 دقيقة')

    render(<DurationText minutes={null} />)
    expect(screen.getByText(ar.common.none)).toBeInTheDocument()
  })
})
