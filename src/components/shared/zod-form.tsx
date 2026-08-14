import * as React from 'react'
import type { ZodError, ZodObject, ZodRawShape, ZodType } from 'zod'

import { FormField, type FormFieldProps } from '@/components/shared/form-field'

/**
 * Binding a form to its Zod schema.
 *
 * SPEC §3 puts one schema per input, "shared between server action and form".
 * The server half of that already holds — every action parses before it acts.
 * This is the client half: the same schema decides which fields are marked
 * required and which message appears under which control, so the two can never
 * disagree about what the rules are.
 *
 * What it deliberately is **not**: a form library. There is no field
 * registration, no controlled-input abstraction, no re-render bookkeeping. The
 * forms in this product are short, they submit through server actions, and the
 * only two things worth centralising are "which message goes where" and "which
 * fields are optional".
 */

export type FieldErrors = Record<string, string>

/**
 * `ZodError` → `{ fieldName: message }`.
 *
 * First issue per field wins. A control shows one message; the second one for
 * the same field is invisible either way, and picking the first keeps the
 * choice deterministic rather than dependent on issue ordering.
 *
 * Nested paths are joined with `.` (`payment.method`) and array indices are
 * kept (`rows.2.amount`), so an importer can address a specific row's cell.
 */
export function issuesToErrors(error: ZodError): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_'
    if (!(key in errors)) errors[key] = issue.message
  }
  return errors
}

export interface ValidationResult<T> {
  ok: boolean
  data?: T
  errors: FieldErrors
}

/** `safeParse`, reshaped into what a form actually renders. */
export function validate<T>(schema: ZodType<T>, values: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(values)
  return parsed.success
    ? { ok: true, data: parsed.data, errors: {} }
    : { ok: false, errors: issuesToErrors(parsed.error) }
}

/**
 * Whether a field may be omitted, asked of the schema rather than of a prop.
 *
 * `undefined` parsing cleanly is the definition of optional here — which also
 * treats a field with a default as optional, correctly: the user does not have
 * to supply it.
 */
export function isOptionalField(schema: ZodObject<ZodRawShape>, name: string): boolean {
  // `ZodObject['shape']` is typed against zod's internal base rather than the
  // public `ZodType`, so the narrowing is stated here once instead of at every
  // call site.
  const field = (schema.shape as Record<string, ZodType | undefined>)[name]
  if (!field) return true
  return field.safeParse(undefined).success
}

/**
 * `FormField`, with `required` and `error` derived from the schema and the
 * error map instead of restated at every call site. Everything else is
 * `FormField` — this only removes the two props that were being kept in sync
 * by hand.
 */
export function ZodFormField({
  schema,
  name,
  errors,
  ...props
}: Omit<FormFieldProps, 'error' | 'required'> & {
  schema: ZodObject<ZodRawShape>
  errors?: FieldErrors
}) {
  const error = errors?.[name]

  return (
    <FormField
      name={name}
      required={!isOptionalField(schema, name)}
      {...(error === undefined ? {} : { error })}
      {...props}
    />
  )
}

/**
 * Field errors held in state, cleared per field as the user edits.
 *
 * The clearing is the point: leaving a message under a control the user is
 * actively fixing is how a form ends up shouting at someone who has already
 * corrected the problem.
 */
export function useFieldErrors(): {
  errors: FieldErrors
  setErrors: (errors: FieldErrors) => void
  clearField: (name: string) => void
  reset: () => void
} {
  const [errors, setErrors] = React.useState<FieldErrors>({})

  const clearField = React.useCallback((name: string) => {
    setErrors((current) => {
      if (!(name in current)) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const reset = React.useCallback(() => setErrors({}), [])

  return { errors, setErrors, clearField, reset }
}
