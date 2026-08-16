'use client'

import * as React from 'react'

import { useToast } from '@/components/shared/toast'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ar } from '@/i18n/ar'
import { updateNotificationPreferenceAction } from '@/modules/notification/actions'
import type { NotificationPreferenceDto } from '@/modules/notification/types'

/**
 * One row per `NotificationType` (16 today), each an optimistic checkbox.
 * `TASK_ASSIGNED`/`TASK_OVERDUE` render checked, disabled and greyed with an
 * explanation — per the phase brief: "cannot be disabled — enforce
 * server-side, and grey them out with an explanation in UI." The server-side
 * half is `modules/notification/service.ts.setPreference`; this component
 * never needs its own copy of that rule, because the checkbox for those two
 * types is simply never interactive.
 */
export function NotificationPreferencesClient({
  initialPreferences,
}: {
  initialPreferences: NotificationPreferenceDto[]
}) {
  const [preferences, setPreferences] = React.useState(initialPreferences)
  const [pendingType, setPendingType] = React.useState<string | null>(null)
  const { toast } = useToast()

  function toggle(pref: NotificationPreferenceDto) {
    if (pref.locked) return
    const nextEnabled = !pref.enabled

    setPreferences((current) =>
      current.map((p) => (p.type === pref.type ? { ...p, enabled: nextEnabled } : p)),
    )
    setPendingType(pref.type)

    void updateNotificationPreferenceAction({ type: pref.type, enabled: nextEnabled })
      .then(() => {
        toast({ title: ar.notifications.preferences.saved, tone: 'success' })
      })
      .catch(() => {
        // Roll back the optimistic flip — the same shape every optimistic
        // mutation in this app uses (CLAUDE.md: "optimistic updates + toast").
        setPreferences((current) =>
          current.map((p) => (p.type === pref.type ? { ...p, enabled: pref.enabled } : p)),
        )
        toast({ title: ar.errors.unexpected, tone: 'error' })
      })
      .finally(() => setPendingType(null))
  }

  return (
    <ul className="divide-border flex flex-col divide-y rounded-lg border">
      {preferences.map((pref) => {
        const id = `notification-pref-${pref.type}`
        return (
          <li key={pref.type} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={id} className="font-medium">
                {ar.notifications.types[pref.type]}
              </Label>
              {pref.locked ? (
                <p className="text-fg-subtle text-xs">
                  <span
                    data-hue="amber"
                    className="text-hue-text bg-hue-surface me-1.5 rounded px-1 py-0.5 text-[0.6875rem] font-medium"
                  >
                    {ar.notifications.preferences.mandatory}
                  </span>
                  {ar.notifications.preferences.mandatoryHint}
                </p>
              ) : null}
            </div>
            <Checkbox
              id={id}
              checked={pref.enabled}
              disabled={pref.locked || pendingType === pref.type}
              onChange={() => toggle(pref)}
              aria-label={
                pref.enabled
                  ? ar.notifications.preferences.enabled
                  : ar.notifications.preferences.disabled
              }
              className="mt-1 shrink-0"
            />
          </li>
        )
      })}
    </ul>
  )
}
