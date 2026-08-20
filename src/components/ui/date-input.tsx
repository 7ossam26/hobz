'use client'

import { CalendarDays } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_KEY = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/** The stable, user-facing form; the underlying control continues to carry ISO. */
export function formatDateInputDisplay(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = DATE_KEY.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

/** `dd/mm/yyyy, HH:mm`, while the native value remains `YYYY-MM-DDTHH:mm`. */
export function formatDateTimeInputDisplay(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = DATE_TIME_KEY.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}, ${match[4]}:${match[5]}` : ''
}

type NativeInputProps = Omit<React.ComponentProps<'input'>, 'type'>

interface PickerInputProps extends NativeInputProps {
  nativeType: 'date' | 'datetime-local'
  displayValue: string
  placeholder: string
}

/**
 * A deterministic display over a real native picker.
 *
 * Browsers own the text painted inside `type=date`, including its field order,
 * so locale hints cannot guarantee `dd/mm/yyyy`. The native input therefore
 * remains the focusable, form-owning control, stretched over this wrapper with
 * transparent text; the product-owned display underneath is stable everywhere.
 * Values and change events still come directly from the native input as ISO.
 *
 * `showPicker()` stays click-only. Sheets autofocus their first control through
 * `use-modal.ts`; opening a picker on focus would reopen the original modal bug.
 */
function PickerInput({
  nativeType,
  displayValue,
  placeholder,
  className,
  onClick,
  disabled,
  ...props
}: PickerInputProps) {
  function handleClick(event: React.MouseEvent<HTMLInputElement>) {
    onClick?.(event)
    if (event.defaultPrevented) return

    try {
      event.currentTarget.showPicker?.()
    } catch {
      // Older Safari and calls without user activation fall back to the
      // browser's ordinary native-picker behaviour.
    }
  }

  return (
    <span
      className={cn(
        'border-input bg-surface-field relative flex h-9 w-full min-w-[9.5rem] items-center rounded-md border shadow-xs transition-colors',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
        'has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-destructive/20',
        className,
      )}
      data-slot="picker-input"
    >
      <span
        aria-hidden="true"
        dir="ltr"
        className={cn(
          'pointer-events-none flex w-full items-center justify-between gap-2 px-3 text-sm tabular-nums',
          !displayValue && 'text-muted-foreground',
        )}
      >
        <span>{displayValue || placeholder}</span>
        <CalendarDays className="size-4 shrink-0" />
      </span>
      <input
        {...props}
        type={nativeType}
        dir="ltr"
        disabled={disabled}
        onClick={handleClick}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        data-slot="input"
      />
    </span>
  )
}

function DateInput({
  className,
  value,
  defaultValue,
  onChange,
  ...props
}: NativeInputProps) {
  const [internalValue, setInternalValue] = React.useState(
    typeof defaultValue === 'string' ? defaultValue : '',
  )
  const currentValue = value ?? internalValue
  return (
    <PickerInput
      {...props}
      value={value}
      defaultValue={defaultValue}
      onChange={(event) => {
        if (value === undefined) setInternalValue(event.currentTarget.value)
        onChange?.(event)
      }}
      nativeType="date"
      displayValue={formatDateInputDisplay(currentValue)}
      placeholder="dd/mm/yyyy"
      className={className}
    />
  )
}

function DateTimeInput({
  className,
  value,
  defaultValue,
  onChange,
  ...props
}: NativeInputProps) {
  const [internalValue, setInternalValue] = React.useState(
    typeof defaultValue === 'string' ? defaultValue : '',
  )
  const currentValue = value ?? internalValue
  return (
    <PickerInput
      {...props}
      value={value}
      defaultValue={defaultValue}
      onChange={(event) => {
        if (value === undefined) setInternalValue(event.currentTarget.value)
        onChange?.(event)
      }}
      nativeType="datetime-local"
      displayValue={formatDateTimeInputDisplay(currentValue)}
      placeholder="dd/mm/yyyy, HH:mm"
      className={className}
    />
  )
}

export { DateInput, DateTimeInput }
