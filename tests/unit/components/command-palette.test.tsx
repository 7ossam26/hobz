// @vitest-environment jsdom
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandPaletteProvider } from '@/components/layout/command-palette'
import { PreferencesProvider } from '@/components/layout/preferences-provider'
import { DEFAULT_PREFERENCES } from '@/lib/preferences'
import { loadCommandDirectoryAction } from '@/modules/search/actions'
import { fireEvent, render, screen } from '@tests/helpers/render'

/**
 * Regression for a global keydown crash: the `Ctrl/Cmd+K` listener used to
 * call `event.key.toLowerCase()` before checking `event.key` was a string.
 * Real browser events always carry a string `key`, but a synthetic/malformed
 * `KeyboardEvent` (test harnesses, some autofill/extension content scripts)
 * can dispatch one without it, which threw inside a raw `document` listener —
 * an uncaught exception on a keystroke that looks like it came from anywhere
 * in the app, not from the palette itself.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/modules/search/actions', () => ({
  loadCommandDirectoryAction: vi.fn(),
}))

// `restoreMocks: true` (vitest.config.ts) strips the resolved-value
// implementation back off after every test, so it has to be reapplied here
// rather than once in the `vi.mock` factory above.
beforeEach(() => {
  vi.mocked(loadCommandDirectoryAction).mockResolvedValue({ users: [], roles: [] })
})

function Harness() {
  return (
    <PreferencesProvider initial={DEFAULT_PREFERENCES}>
      <CommandPaletteProvider navItems={[]}>
        <div>{null}</div>
      </CommandPaletteProvider>
    </PreferencesProvider>
  )
}

describe('CommandPaletteProvider — استماع لوحة المفاتيح العام', () => {
  it('لا ينهار عند حدث لوحة مفاتيح بلا خاصية key معرّفة', () => {
    render(<Harness />)

    expect(() => {
      fireEvent.keyDown(document, { key: undefined, ctrlKey: true })
    }).not.toThrow()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('يفتح اللوحة عند Ctrl+K رغم الإصلاح', () => {
    render(<Harness />)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
