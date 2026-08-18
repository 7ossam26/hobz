'use client'

import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import type { TaxonomyEntry } from '@/lib/settings/catalog'
import { cn } from '@/lib/utils'

import type { SettingField } from './field-map'

/**
 * One control per `SettingField.kind`.
 *
 * Every control is *fully* controlled: it renders the draft value it is given
 * and reports a new one. It never validates — the catalog's Zod schema does
 * that, once, in `settings-client.tsx` before the action is called and again in
 * `parseSettingValue` on the server (CLAUDE.md invariant 3: the second one is
 * the check that counts). A control that did its own validation would be a
 * third definition of the same rule, drifting from both.
 *
 * All spacing is logical (`ms-*`/`me-*`, `start`/`end`) — never `ml`/`mr`.
 */

export interface ControlProps {
  id: string
  field: SettingField
  value: unknown
  disabled: boolean
  onChange: (next: unknown) => void
}

export function SettingControl(props: ControlProps) {
  switch (props.field.kind) {
    case 'number':
      return <NumberControl {...props} field={props.field} />
    case 'boolean':
      return <BooleanControl {...props} />
    case 'select':
      return <SelectControl {...props} field={props.field} />
    case 'time':
      return <TimeControl {...props} />
    case 'enumSet':
      return <EnumSetControl {...props} field={props.field} />
    case 'taxonomy':
      return <TaxonomyControl {...props} />
    case 'stringList':
      return <StringListControl {...props} />
    case 'labelMap':
      return <LabelMapControl {...props} field={props.field} />
    case 'templateMap':
      return <TemplateMapControl {...props} field={props.field} />
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scalars
// ─────────────────────────────────────────────────────────────────────────────

function NumberControl({
  id,
  field,
  value,
  disabled,
  onChange,
}: ControlProps & { field: Extract<SettingField, { kind: 'number' }> }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        className="max-w-40 tabular-nums"
        value={typeof value === 'number' && Number.isFinite(value) ? String(value) : ''}
        min={field.min}
        max={field.max}
        step={field.step ?? 1}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value
          // An empty box is not zero. Reporting NaN keeps the draft invalid (the
          // Zod parse rejects it) instead of silently saving a 0 the operator
          // never typed — several of these keys are a penalty rate.
          onChange(raw === '' ? Number.NaN : Number(raw))
        }}
      />
      {field.unit ? (
        <span className="text-muted-foreground text-sm">{field.unit}</span>
      ) : null}
    </div>
  )
}

function BooleanControl({ id, value, disabled, onChange }: ControlProps) {
  const checked = value === true
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <Label htmlFor={id} className="text-muted-foreground font-normal">
        {checked ? ar.common.yes : ar.common.no}
      </Label>
    </div>
  )
}

function SelectControl({
  id,
  field,
  value,
  disabled,
  onChange,
}: ControlProps & { field: Extract<SettingField, { kind: 'select' }> }) {
  return (
    <Select
      id={id}
      className="max-w-md"
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {field.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

function TimeControl({ id, value, disabled, onChange }: ControlProps) {
  return (
    <Input
      id={id}
      type="time"
      className="max-w-40 tabular-nums"
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sets and lists
// ─────────────────────────────────────────────────────────────────────────────

function EnumSetControl({
  id,
  field,
  value,
  disabled,
  onChange,
}: ControlProps & { field: Extract<SettingField, { kind: 'enumSet' }> }) {
  const selected = new Set(Array.isArray(value) ? (value as string[]) : [])

  return (
    <div id={id} className="flex flex-wrap gap-x-5 gap-y-2">
      {field.options.map((option) => {
        const optionId = `${id}-${option.value}`
        return (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={optionId}
              checked={selected.has(option.value)}
              disabled={disabled}
              onChange={(event) => {
                // Rebuilt from the option order, not from click order, so the
                // stored array is stable and a diff is a real change.
                const next = field.options
                  .map((o) => o.value)
                  .filter((v) =>
                    v === option.value ? event.target.checked : selected.has(v),
                  )
                onChange(next)
              }}
            />
            <Label htmlFor={optionId} className="font-normal">
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A `[{ id, label }]` taxonomy.
 *
 * The id of a **saved** entry is read-only, because `Task.categoryId` and
 * `Leave.typeId` point at it (SPEC §7): editing it would silently orphan every
 * row filed under it, which is the exact failure the id/label split exists to
 * prevent. Renaming is what the label box is for. A newly added row's id is
 * editable until the first save, because nothing references it yet.
 */
function TaxonomyControl({ id, value, disabled, onChange }: ControlProps) {
  const entries: TaxonomyEntry[] = Array.isArray(value) ? (value as TaxonomyEntry[]) : []
  const savedIds = useSavedIds(entries)

  function update(index: number, patch: Partial<TaxonomyEntry>) {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  return (
    <div id={id} className="flex flex-col gap-2">
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">{ar.settings.list.empty}</p>
      ) : null}

      {entries.map((entry, index) => {
        const locked = savedIds.has(entry.id)
        return (
          <div key={index} className="flex items-start gap-2">
            <Input
              className="max-w-44 font-mono text-xs"
              dir="ltr"
              value={entry.id}
              disabled={disabled || locked}
              aria-label={ar.settings.list.itemId}
              title={locked ? ar.settings.list.idLocked : ar.settings.list.idHint}
              onChange={(event) => update(index, { id: event.target.value })}
            />
            <Input
              className="max-w-xs"
              value={entry.label}
              disabled={disabled}
              aria-label={ar.settings.list.itemLabel}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || entries.length <= 1}
              aria-label={ar.common.remove}
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        )
      })}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...entries, { id: '', label: '' }])}
        >
          <Plus aria-hidden />
          {ar.settings.list.addItem}
        </Button>
      </div>
    </div>
  )
}

/**
 * The ids present on first render — i.e. the ones already persisted. Held in a
 * ref so that typing in a *new* row does not progressively lock it, and so a
 * row added and then edited stays editable for the whole session.
 */
function useSavedIds(entries: readonly TaxonomyEntry[]): Set<string> {
  const ref = React.useRef<Set<string> | null>(null)
  ref.current ??= new Set(entries.map((entry) => entry.id).filter(Boolean))
  return ref.current
}

function StringListControl({ id, value, disabled, onChange }: ControlProps) {
  const items: string[] = Array.isArray(value) ? (value as string[]) : []

  return (
    <div id={id} className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{ar.settings.list.empty}</p>
      ) : null}

      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="max-w-xs"
            value={item}
            disabled={disabled}
            aria-label={ar.settings.list.itemLabel}
            onChange={(event) =>
              onChange(items.map((v, i) => (i === index ? event.target.value : v)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || items.length <= 1}
            aria-label={ar.common.remove}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...items, ''])}
        >
          <Plus aria-hidden />
          {ar.settings.list.addItem}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Maps
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {}
}

function LabelMapControl({
  id,
  field,
  value,
  disabled,
  onChange,
}: ControlProps & { field: Extract<SettingField, { kind: 'labelMap' }> }) {
  const record = asRecord(value)

  return (
    <div id={id} className="grid gap-2 sm:grid-cols-2">
      {field.entries.map((entry) => {
        const fieldId = `${id}-${entry.key}`
        return (
          <div key={entry.key} className="flex flex-col gap-1">
            {/* The enum member itself, LTR and monospaced — it is a code value,
                not prose, and SPEC §2 fixes it: only the Arabic label is editable. */}
            <Label
              htmlFor={fieldId}
              className="text-muted-foreground font-mono text-[0.6875rem]"
              dir="ltr"
            >
              {entry.key}
            </Label>
            <Input
              id={fieldId}
              value={record[entry.key] ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...record, [entry.key]: event.target.value })
              }
            />
          </div>
        )
      })}
    </div>
  )
}

function TemplateMapControl({
  id,
  field,
  value,
  disabled,
  onChange,
}: ControlProps & { field: Extract<SettingField, { kind: 'templateMap' }> }) {
  const record = asRecord(value)
  const variablesHint = ar.settings.templates.variablesHint.replace(
    '{list}',
    field.variables.map((v) => `{${v.token}} = ${v.label}`).join(ar.common.listSeparator),
  )

  return (
    <div id={id} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{variablesHint}</p>
      {field.entries.map((entry) => {
        const fieldId = `${id}-${entry.key}`
        return (
          <div key={entry.key} className="flex flex-col gap-1">
            <Label htmlFor={fieldId}>{entry.label}</Label>
            <Textarea
              id={fieldId}
              rows={2}
              value={record[entry.key] ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...record, [entry.key]: event.target.value })
              }
            />
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared chrome
// ─────────────────────────────────────────────────────────────────────────────

export function RestoreDefaultButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void
  disabled: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn('text-muted-foreground', className)}
      disabled={disabled}
      onClick={onClick}
    >
      <RotateCcw aria-hidden />
      {ar.settings.restoreDefault}
    </Button>
  )
}
