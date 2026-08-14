import * as React from 'react'

import { Label } from '@/components/ui/label'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'

/**
 * Label + control + error, wired to the Zod issue for the same field.
 *
 * `aria-invalid` and `aria-describedby` are set from the presence of an error
 * rather than left to each form to remember: an error a sighted user can see
 * and a screen-reader user cannot is the kind of bug that never gets filed.
 */
export interface FormFieldProps {
  name: string
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  className?: string
  children: (props: {
    id: string
    name: string
    'aria-invalid': boolean
    'aria-describedby': string | undefined
  }) => React.ReactNode
}

export function FormField({
  name,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const id = `field-${name}`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive text-xs" aria-hidden>
            *
          </span>
        ) : (
          <span className="text-muted-foreground text-xs font-normal">
            {ar.common.optional}
          </span>
        )}
      </Label>

      {children({
        id,
        name,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
      })}

      {hint && !error ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  )
}
