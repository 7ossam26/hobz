import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { Chip, type ChipProps } from '@/components/data/chip'
import { ar } from '@/i18n/ar'
import { healthHue, type Health } from '@/lib/palette'

/**
 * Project health, RAG (SPEC §5.7).
 *
 * Carries an icon as well as a hue, and that is not decoration: red/green is
 * the single most common colour-vision confusion, and health is the one signal
 * on a manager's dashboard that a person is meant to react to. Shape makes it
 * readable without colour; colour makes it readable without reading.
 *
 * `overridden` marks a health a human set by hand (SPEC §5.7 allows a manual
 * override with a mandatory reason). A computed RED and a declared RED mean
 * very different things in a status meeting, so the badge says which it is.
 */

const HEALTH_ICON = {
  GREEN: CircleCheck,
  AMBER: TriangleAlert,
  RED: CircleAlert,
} as const

export function HealthBadge({
  health,
  overridden,
  reason,
  ...props
}: Omit<ChipProps, 'hue' | 'children'> & {
  health: string
  overridden?: boolean
  /** The mandatory override reason, surfaced as the tooltip. */
  reason?: string
}) {
  const key = (health in HEALTH_ICON ? health : 'AMBER') as Health
  const Icon = HEALTH_ICON[key]

  return (
    <Chip
      hue={healthHue(key)}
      title={reason ?? undefined}
      tone={overridden ? 'outline' : 'soft'}
      {...props}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {ar.health[key]}
      {overridden ? (
        <span className="opacity-70">{`(${ar.health.override})`}</span>
      ) : null}
    </Chip>
  )
}
