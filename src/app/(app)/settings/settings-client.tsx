'use client'

import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { useToast } from '@/components/shared/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ar } from '@/i18n/ar'
import {
  SETTINGS_CATALOG,
  type SettingGroup,
  type SettingKey,
} from '@/lib/settings/catalog'
import { updateSettingsAction } from '@/modules/setting/actions'
import type { SettingDto } from '@/modules/setting/types'

import { SETTING_FIELDS } from './field-map'
import { RestoreDefaultButton, SettingControl } from './setting-controls'

/**
 * The Settings editor (SPEC §7).
 *
 * **One draft, one save.** Every group is a card, but the save button is
 * global and writes through `updateSettingsAction`, which wraps the whole batch
 * in one transaction. Half-applied settings would leave the business rules in a
 * state nobody chose — a grace period from the new policy with a penalty rate
 * from the old one is not a configuration, it is an accident.
 *
 * **Validation happens twice, on purpose.** Here, against the same catalog
 * schema the server uses, so the operator sees which box is wrong instead of a
 * generic failure; and again in `parseSettingValue` server-side, which is the
 * check that counts (CLAUDE.md invariant 3). The audit row and the cache
 * invalidation are the action's job, not this component's.
 */

export interface SettingsGroupView {
  group: SettingGroup
  settings: SettingDto[]
}

interface Props {
  groups: SettingsGroupView[]
  canEdit: boolean
  /** Rendered inside the calendar card — holidays are a table, not a Setting. */
  holidaysSlot: React.ReactNode
}

type Draft = Record<string, unknown>

/** Structural equality via JSON: every catalog value is JSON by construction. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function SettingsClient({ groups, canEdit, holidaysSlot }: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const initial = React.useMemo<Draft>(() => {
    const map: Draft = {}
    for (const group of groups) {
      for (const setting of group.settings) map[setting.key] = setting.value
    }
    return map
  }, [groups])

  const [draft, setDraft] = React.useState<Draft>(initial)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  // A successful save re-renders the page from the server; adopt those values
  // as the new baseline so the dirty count returns to zero.
  React.useEffect(() => setDraft(initial), [initial])

  const dirtyKeys = React.useMemo(
    () => Object.keys(initial).filter((key) => !same(draft[key], initial[key])),
    [draft, initial],
  )

  function set(key: SettingKey, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function discard() {
    setDraft(initial)
    setErrors({})
  }

  function save() {
    const updates: Array<{ key: string; value: unknown }> = []
    const found: Record<string, string> = {}

    for (const key of dirtyKeys) {
      const parsed = SETTINGS_CATALOG[key as SettingKey].schema.safeParse(draft[key])
      if (parsed.success) updates.push({ key, value: parsed.data })
      // The Zod message is English and often structural ("Too small"). The
      // operator gets the one Arabic sentence that is always true — the field
      // itself is highlighted, which is the part that locates the problem.
      else found[key] = ar.settings.invalidValue
    }

    if (Object.keys(found).length > 0) {
      setErrors(found)
      return
    }
    if (updates.length === 0) return

    setSaving(true)
    void updateSettingsAction({ updates })
      .then(() => {
        toast({ title: ar.settings.saved, tone: 'success' })
        router.refresh()
      })
      .catch(() => {
        toast({ title: ar.settings.saveFailed, tone: 'error' })
      })
      .finally(() => setSaving(false))
  }

  const disabled = !canEdit || saving

  return (
    <div className="flex flex-col gap-6 pb-24">
      {!canEdit ? (
        <p
          data-hue="amber"
          className="text-hue-text bg-hue-surface flex items-center gap-2 rounded-md px-3 py-2 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {ar.settings.readOnly}
        </p>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row-reverse lg:items-start">
        {/* Section index. `lg:sticky` only — on a phone it is just a list at
            the top, which is cheaper than a drawer nobody opens. */}
        <nav
          aria-label={ar.settings.sections}
          className="lg:bg-card flex shrink-0 flex-wrap gap-1 lg:sticky lg:top-20 lg:w-56 lg:flex-col lg:rounded-lg lg:border lg:p-2"
        >
          {groups.map((group) => (
            <a
              key={group.group}
              href={`#settings-${group.group}`}
              className="hover:bg-accent hover:text-accent-foreground rounded-md px-3 py-1.5 text-sm"
            >
              {ar.settings.groups[group.group]}
            </a>
          ))}
          <a
            href="#settings-holidays"
            className="hover:bg-accent hover:text-accent-foreground rounded-md px-3 py-1.5 text-sm"
          >
            {ar.settings.groups.holidays}
          </a>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {groups.map((group) => (
            <GroupCard
              key={group.group}
              group={group}
              draft={draft}
              errors={errors}
              disabled={disabled}
              onChange={set}
            />
          ))}

          <Card id="settings-holidays" className="scroll-mt-20">
            <CardHeader>
              <CardTitle>{ar.settings.groups.holidays}</CardTitle>
              <CardDescription>{ar.settings.groupHints.holidays}</CardDescription>
            </CardHeader>
            <CardContent>{holidaysSlot}</CardContent>
          </Card>
        </div>
      </div>

      {canEdit ? (
        <div className="bg-surface-overlay fixed inset-x-0 bottom-0 z-30 border-t">
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
            <p className="text-muted-foreground text-sm tabular-nums">
              {dirtyKeys.length === 0
                ? ar.settings.noChanges
                : ar.settings.unsavedChanges.replace('{count}', String(dirtyKeys.length))}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={dirtyKeys.length === 0 || saving}
                onClick={discard}
              >
                {ar.settings.discard}
              </Button>
              <Button
                type="button"
                disabled={dirtyKeys.length === 0 || saving}
                onClick={save}
              >
                {saving ? ar.common.saving : ar.settings.save}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GroupCard({
  group,
  draft,
  errors,
  disabled,
  onChange,
}: {
  group: SettingsGroupView
  draft: Draft
  errors: Record<string, string>
  disabled: boolean
  onChange: (key: SettingKey, value: unknown) => void
}) {
  return (
    <Card id={`settings-${group.group}`} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{ar.settings.groups[group.group]}</CardTitle>
        <CardDescription>{ar.settings.groupHints[group.group]}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {group.settings.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={setting}
            value={draft[setting.key]}
            error={errors[setting.key]}
            disabled={disabled}
            onChange={onChange}
          />
        ))}

        {group.group === 'performance' ? (
          <WeightTotal draft={draft} settings={group.settings} />
        ) : null}
      </CardContent>
    </Card>
  )
}

function SettingRow({
  setting,
  value,
  error,
  disabled,
  onChange,
}: {
  setting: SettingDto
  value: unknown
  error: string | undefined
  disabled: boolean
  onChange: (key: SettingKey, value: unknown) => void
}) {
  const field = SETTING_FIELDS[setting.key]
  const id = `setting-${setting.key}`
  const defaultValue = SETTINGS_CATALOG[setting.key].default
  const isDefault = same(value, defaultValue)

  return (
    <div className="flex flex-col gap-2 border-b pb-5 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="font-medium">
          {ar.settings.keys[setting.key]}
          {isDefault ? (
            <Badge variant="outline" className="text-muted-foreground font-normal">
              {ar.settings.isDefault}
            </Badge>
          ) : null}
        </Label>

        {!isDefault ? (
          <RestoreDefaultButton
            disabled={disabled}
            onClick={() => onChange(setting.key, structuredClone(defaultValue))}
          />
        ) : null}
      </div>

      <SettingControl
        id={id}
        field={field}
        value={value}
        disabled={disabled}
        onChange={(next) => onChange(setting.key, next)}
      />

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The four weights, added up. Informational: `computePerformanceScore` divides
 * by the actual sum (SPEC §5.6), so a total of 90 is a valid configuration and
 * blocking the save on it would be inventing a rule the engine does not have.
 */
function WeightTotal({ draft, settings }: { draft: Draft; settings: SettingDto[] }) {
  const total = settings.reduce((sum, setting) => {
    const value = draft[setting.key]
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  }, 0)

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <span>{ar.settings.weights.total}</span>
      <span className="text-foreground font-medium tabular-nums">{total}%</span>
      {total !== 100 ? (
        <span data-hue="amber" className="text-hue-text text-xs">
          {ar.settings.weights.notHundred}
        </span>
      ) : null}
    </p>
  )
}
