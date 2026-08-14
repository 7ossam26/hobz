// @vitest-environment jsdom
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppSidebar } from '@/components/layout/app-sidebar'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { PreferencesProvider } from '@/components/layout/preferences-provider'
import { ar } from '@/i18n/ar'
import { NAV_ITEMS, type NavItem } from '@/lib/navigation'
import { DEFAULT_PREFERENCES, SIDEBAR_COOKIE, type ShellPreferences } from '@/lib/preferences'
import { fireEvent, render, screen, within } from '@tests/helpers/render'

/**
 * docs/TESTING.md §4 axis 10: RTL rendering.
 *
 * The whole product is `dir="rtl"`, and the failure mode is silent — a `ml-4`
 * or a `border-r` looks correct to anyone reading the code in English and lands
 * on the wrong side of the screen in Arabic. eslint catches those in source;
 * these tests catch the ones that would survive it, by asserting on the
 * *rendered* markup and on DOM order.
 *
 * The sidebar's position is the clearest example. Nothing in `AppSidebar` says
 * "right". It is the first child of a flex row, and under RTL the browser puts
 * the first child at the inline start — which is the right-hand edge. That is
 * why the test asserts document order rather than a CSS property.
 */

const pathname = vi.hoisted(() => ({ current: '/users' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const ITEMS: NavItem[] = [...NAV_ITEMS]

function renderShell(preferences: Partial<ShellPreferences> = {}) {
  return render(
    <div dir="rtl">
      <PreferencesProvider initial={{ ...DEFAULT_PREFERENCES, ...preferences }}>
        <div className="flex">
          <AppSidebar items={ITEMS} />
          <div>
            <header>
              <Breadcrumb />
            </header>
            <main id="main">{ar.designSystem.samples.paragraph}</main>
          </div>
        </div>
      </PreferencesProvider>
    </div>,
  )
}

/** Physical directions that would silently mirror wrong under RTL. */
const PHYSICAL_CLASS =
  /(^|\s)(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(-|$|\s)/

beforeEach(() => {
  pathname.current = '/users'
  document.cookie = `${SIDEBAR_COOKIE}=; max-age=0; path=/`
})

describe('اتجاه الواجهة', () => {
  it('القائمة الجانبية تسبق المحتوى في ترتيب المستند فتقع في بداية السطر', () => {
    // Under RTL the inline start is the right-hand edge, so document order —
    // not a `right:` rule — is what puts the sidebar on the right.
    const { container } = renderShell()
    const row = container.querySelector('.flex')!

    expect(row.children[0]?.tagName).toBe('ASIDE')
    expect(row.children[1]?.querySelector('main')).toBeTruthy()
  })

  it('الفاصل على الحافة الداخلية للقائمة لا على حافة الشاشة', () => {
    // `border-e`, not `border-s`: the divider belongs between the sidebar and
    // the content beside it. `border-s` would draw a line down the outer edge
    // of the screen and leave the two panes touching.
    const { container } = renderShell()
    expect(container.querySelector('aside')).toHaveClass('border-e')
  })

  it('لا يوجد أي صنف باتجاه فيزيائي في هيكل التطبيق المرسوم', () => {
    const { container } = renderShell()

    const offenders = Array.from(container.querySelectorAll<HTMLElement>('[class]'))
      .map((element) => element.className)
      .filter((className) => typeof className === 'string' && PHYSICAL_CLASS.test(className))

    expect(offenders).toEqual([])
  })

  it('المستند نفسه يعلن الاتجاه من اليمين لليسار', () => {
    const { container } = renderShell()
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl')
  })
})

describe('AppSidebar', () => {
  it('يرسم عناصر التنقل التي مرّرها الخادم فقط', () => {
    // The filtering is a permission decision and happens server-side
    // (CLAUDE.md invariant 3). The sidebar draws what it is given.
    render(
      <PreferencesProvider initial={DEFAULT_PREFERENCES}>
        <AppSidebar items={[ITEMS[0]!]} />
      </PreferencesProvider>,
    )

    expect(screen.getByRole('link', { name: ar.nav.dashboard })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: ar.nav.users })).not.toBeInTheDocument()
  })

  it('يعلن الصفحة الحالية بـ aria-current', () => {
    // Scoped to the sidebar: the breadcrumb names the same destinations, and an
    // unscoped query would be asserting on whichever one happened to render.
    const sidebar = within(renderShell().container.querySelector('aside')!)

    expect(sidebar.getByRole('link', { name: ar.nav.users })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(sidebar.getByRole('link', { name: ar.nav.dashboard })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('المسار الفرعي يُبقي القسم الأب نشطًا', () => {
    pathname.current = '/users/new'
    const sidebar = within(renderShell().container.querySelector('aside')!)

    expect(sidebar.getByRole('link', { name: ar.nav.users })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('عند الطيّ تبقى الأسماء متاحة لقارئ الشاشة وللتلميح', () => {
    // Icon-only is a *visual* collapse. Hiding the name from assistive
    // technology would make the sidebar unusable rather than narrow.
    const sidebar = within(renderShell({ sidebar: 'collapsed' }).container.querySelector('aside')!)

    const link = sidebar.getByRole('link', { name: ar.nav.users })
    expect(link).toHaveAttribute('title', ar.nav.users)
    expect(link.querySelector('span:not([class*="absolute"])')).toHaveClass('sr-only')
  })

  it('زر الطيّ يعلن حالته ويبدّلها ويحفظها في الكوكي', () => {
    renderShell()

    const toggle = screen.getByRole('button', { name: ar.shell.collapseSidebar })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)

    expect(
      screen.getByRole('button', { name: ar.shell.expandSidebar }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`)
  })

  it('يستخدم متغيّرات عرض الهيكل بدل أرقام ثابتة', () => {
    const { container } = renderShell()
    expect(container.querySelector('aside')?.className).toContain('--shell-sidebar-w')
  })
})

describe('Breadcrumb', () => {
  it('يبني المسار من جدول التنقل نفسه', () => {
    renderShell()
    const trail = screen.getByRole('navigation', { name: ar.shell.breadcrumb })

    expect(within(trail).getByText(ar.nav.dashboard)).toBeInTheDocument()
    expect(within(trail).getByText(ar.nav.users)).toBeInTheDocument()
  })

  it('آخر عنصر هو الصفحة الحالية وليس رابطًا', () => {
    renderShell()
    const trail = screen.getByRole('navigation', { name: ar.shell.breadcrumb })
    const current = within(trail).getByText(ar.nav.users)

    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.tagName).not.toBe('A')
  })

  it('يُسقط المقاطع التي لا يعرفها بدل طباعة معرّف خام', () => {
    // `لوحة التحكم / المستخدمون / clv8x2k…` tells the reader nothing.
    pathname.current = '/users/clv8x2k9a0000'
    renderShell()

    const trail = screen.getByRole('navigation', { name: ar.shell.breadcrumb })
    expect(trail.textContent).not.toContain('clv8x2k9a0000')
    expect(within(trail).getByText(ar.nav.users)).toBeInTheDocument()
  })

  it('لوحة التحكم جذر كل مسار ولا تتكرر', () => {
    pathname.current = '/dashboard'
    renderShell()

    const trail = screen.getByRole('navigation', { name: ar.shell.breadcrumb })
    expect(within(trail).getAllByText(ar.nav.dashboard)).toHaveLength(1)
  })
})
