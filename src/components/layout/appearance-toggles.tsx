'use client'

import { Moon, Rows2, Rows3, Sun } from 'lucide-react'
import * as React from 'react'

import { usePreferences } from '@/components/layout/preferences-provider'
import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

/**
 * Theme and density.
 *
 * Both are `aria-pressed` toggle buttons rather than switches: there are
 * exactly two states, the icon shows which one you are in, and a switch would
 * need a label beside it to say what it switches.
 *
 * The density toggle is the one SPEC §9 asks for by name ("comfortable /
 * compact, persisted per user"). It changes one attribute on `<html>`; every
 * row height, cell padding and control height in the product is derived from
 * CSS variables under that attribute, so nothing re-renders and nothing
 * re-measures — the layout simply is denser on the next frame.
 */

export function ThemeToggle({ size = 'icon-sm' }: { size?: 'icon-sm' | 'icon' }) {
  const { theme, toggleTheme } = usePreferences()
  const dark = theme === 'dark'

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={ar.a11y.toggleTheme}
      title={`${ar.common.theme}: ${dark ? ar.common.themeDark : ar.common.themeLight}`}
    >
      {dark ? <Moon /> : <Sun />}
    </Button>
  )
}

export function DensityToggle({ size = 'icon-sm' }: { size?: 'icon-sm' | 'icon' }) {
  const { density, toggleDensity } = usePreferences()
  const compact = density === 'compact'

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={toggleDensity}
      aria-pressed={compact}
      aria-label={ar.common.density}
      title={`${ar.common.density}: ${
        compact ? ar.common.densityCompact : ar.common.densityComfortable
      }`}
    >
      {compact ? <Rows3 /> : <Rows2 />}
    </Button>
  )
}

/** Both toggles with their labels, for the user menu where there is room. */
export function AppearanceControls() {
  const { theme, density, toggleTheme, toggleDensity } = usePreferences()

  return (
    <div className="flex flex-col gap-1 px-1 py-1">
      <ControlRow
        label={ar.common.theme}
        value={theme === 'dark' ? ar.common.themeDark : ar.common.themeLight}
        onClick={toggleTheme}
        icon={theme === 'dark' ? <Moon /> : <Sun />}
      />
      <ControlRow
        label={ar.common.density}
        value={
          density === 'compact' ? ar.common.densityCompact : ar.common.densityComfortable
        }
        onClick={toggleDensity}
        icon={density === 'compact' ? <Rows3 /> : <Rows2 />}
      />
    </div>
  )
}

function ControlRow({
  label,
  value,
  icon,
  onClick,
}: {
  label: string
  value: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none"
    >
      <span className="text-fg-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 text-start">{label}</span>
      <span className="text-fg-subtle text-xs">{value}</span>
    </button>
  )
}
