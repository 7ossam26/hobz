// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { ar } from '@/i18n/ar'
import { fireEvent, render, screen } from '@tests/helpers/render'

/**
 * `EntitySheet` is the interaction model, not a container (CLAUDE.md:
 * "everything is edited in a sheet or dialog over the current page… full pages
 * exist only for lists, dashboards, settings, and reports").
 *
 * So the assertions here are about the promises that model makes: the list
 * behind stays mounted, the keyboard cannot escape into it, focus comes back to
 * where it started, and unsaved work is not thrown away by a stray click.
 */

function Harness(props: Partial<React.ComponentProps<typeof EntitySheet>> = {}) {
  const [open, setOpen] = React.useState(true)

  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        {ar.common.open}
      </button>
      <p data-testid="page-content">{ar.designSystem.samples.paragraph}</p>

      <EntitySheet
        open={open}
        onClose={() => setOpen(false)}
        title={ar.designSystem.samples.sheetTitle}
        {...props}
      >
        <input data-testid="first-field" />
        <button type="button" data-testid="last-control">
          {ar.common.save}
        </button>
      </EntitySheet>
    </div>
  )
}

describe('EntitySheet', () => {
  it('لا يرسم شيئًا وهو مغلق', () => {
    render(
      <EntitySheet
        open={false}
        onClose={vi.fn()}
        title={ar.designSystem.samples.sheetTitle}
      >
        <p>{ar.designSystem.samples.sheetBody}</p>
      </EntitySheet>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('يُعلن نفسه كحوار مشروط باسم مقروء', () => {
    render(<Harness />)
    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(
      screen.getByRole('heading', { name: ar.designSystem.samples.sheetTitle }),
    ).toBeInTheDocument()
  })

  it('يُبقي الصفحة خلفه ظاهرة — لا انتقال بعيدًا', () => {
    // The point of the whole model: approving one task and moving to the next
    // never costs a page load, and the row you came from is still on screen.
    render(<Harness />)
    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })

  it('ينقل التركيز إلى أول حقل داخل اللوحة', () => {
    render(<Harness />)
    expect(document.activeElement).toBe(screen.getByTestId('first-field'))
  })

  it('يعيد التركيز إلى العنصر السابق عند الإغلاق', () => {
    // Without this the keyboard lands at the top of the document and the user
    // has to walk the whole page back to the row they were editing.
    render(<Harness />)

    const opener = screen.getByTestId('opener')
    opener.focus()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(screen.getByRole('button', { name: ar.common.close }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('يغلق بمفتاح Escape', () => {
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('يحبس مفتاح Tab داخل اللوحة', () => {
    // Tabbing out would walk into a page a screen-reader user cannot tell is
    // still there.
    render(<Harness />)

    const last = screen.getByTestId('last-control')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })

    const focusable = screen
      .getByRole('dialog')
      .querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
      )
    expect(document.activeElement).toBe(focusable[0])
  })

  it('النقر على الخلفية يغلق اللوحة النظيفة', () => {
    const { container } = render(<Harness />)
    fireEvent.click(container.querySelector('[data-slot="sheet-overlay"]')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('الخلفية مخفية عن قارئ الشاشة فلا يوجد زرّا إغلاق باسم واحد', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[data-slot="sheet-overlay"]')).toHaveAttribute(
      'aria-hidden',
    )
    expect(screen.getAllByRole('button', { name: ar.common.close })).toHaveLength(1)
  })

  it('النقر على الخلفية لا يهدر تعديلات غير محفوظة', () => {
    // `dirty` disables the click-outside exit only. Escape and the close button
    // still work: an overlay you cannot leave is worse than one that lets you
    // lose a draft.
    const { container } = render(<Harness dirty />)

    const overlay = container.querySelector('[data-slot="sheet-overlay"]')!
    fireEvent.click(overlay)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('لا يمكن إغلاقه أثناء الحفظ', () => {
    render(<Harness busy />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('يمنع تمرير الصفحة خلفه ويعيده عند الإغلاق', () => {
    render(<Harness />)
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('يعرض لون هوية العنصر على الحافة العلوية', () => {
    render(<Harness hue="emerald" />)
    expect(screen.getByRole('dialog').querySelector('[data-hue="emerald"]')).toBeTruthy()
  })

  it('يعرض التبويبات ويبدّل المحتوى دون انتقال', () => {
    // Tabs, not sub-routes. The moment a task's comments become a URL, the
    // sheet-first model has leaked.
    const tabs = ar.designSystem.samples.sheetTabs
    render(
      <EntitySheet
        open
        onClose={vi.fn()}
        title={ar.designSystem.samples.sheetTitle}
        tabs={[
          {
            id: 'details',
            label: tabs.details,
            content: (
              <p data-testid="panel-details">{ar.designSystem.samples.sheetBody}</p>
            ),
          },
          {
            id: 'comments',
            label: tabs.comments,
            count: 3,
            content: (
              <p data-testid="panel-comments">{ar.designSystem.samples.paragraph}</p>
            ),
          },
        ]}
      />,
    )

    expect(screen.getByTestId('panel-details')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-comments')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: new RegExp(tabs.comments) }))

    expect(screen.getByTestId('panel-comments')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-details')).not.toBeInTheDocument()
  })

  it('التبويب المختار يعلن نفسه لقارئ الشاشة', () => {
    const tabs = ar.designSystem.samples.sheetTabs
    render(
      <EntitySheet
        open
        onClose={vi.fn()}
        title={ar.designSystem.samples.sheetTitle}
        tabs={[
          { id: 'details', label: tabs.details, content: null },
          { id: 'activity', label: tabs.activity, content: null },
        ]}
      />,
    )

    expect(screen.getByRole('tab', { name: tabs.details })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: tabs.activity })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })
})

describe('EntitySheetFooter', () => {
  it('يضع الإجراء المدمّر بعيدًا عن إجراء التأكيد', () => {
    const { container } = render(
      <EntitySheetFooter
        destructive={<button type="button">{ar.common.delete}</button>}
        secondary={<button type="button">{ar.common.cancel}</button>}
        primary={<button type="button">{ar.common.save}</button>}
      />,
    )

    const labels = Array.from(container.querySelectorAll('button')).map(
      (button) => button.textContent,
    )
    expect(labels).toEqual([ar.common.delete, ar.common.cancel, ar.common.save])
  })
})
