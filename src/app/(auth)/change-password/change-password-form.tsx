'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { FormField } from '@/components/shared/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ar } from '@/i18n/ar'
import { changeOwnPasswordAction } from '@/modules/auth/actions'

function resolveMessage(messageKey: string, params?: Record<string, string | number>) {
  const [section, key] = messageKey.split('.')
  const table = (ar as unknown as Record<string, Record<string, string>>)[section ?? '']
  const text = table?.[key ?? ''] ?? ar.errors.unexpected
  return Object.entries(params ?? {}).reduce(
    (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
    text,
  )
}

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const data = new FormData(event.currentTarget)
    const newPassword = String(data.get('newPassword') ?? '')
    const confirmPassword = String(data.get('confirmPassword') ?? '')

    // Checked client-side too, so the mismatch is caught without a round trip.
    // The schema checks it again server-side, which is the one that counts.
    if (newPassword !== confirmPassword) {
      setError(ar.auth.passwordMismatch)
      return
    }

    startTransition(async () => {
      const failure = await changeOwnPasswordAction({
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword,
        confirmPassword,
      })

      if (failure) {
        setError(resolveMessage(failure.messageKey, failure.params))
        return
      }

      setDone(true)
      router.replace('/dashboard')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {forced ? (
        <p className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm">
          {ar.auth.mustChangePasswordHint}
        </p>
      ) : null}

      <FormField name="currentPassword" label={ar.auth.currentPassword} required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            required
            dir="ltr"
            className="text-start"
          />
        )}
      </FormField>

      <FormField name="newPassword" label={ar.auth.newPassword} required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            required
            dir="ltr"
            className="text-start"
          />
        )}
      </FormField>

      <FormField name="confirmPassword" label={ar.auth.confirmPassword} required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            required
            dir="ltr"
            className="text-start"
          />
        )}
      </FormField>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || done} className="w-full">
        {done ? ar.auth.passwordChanged : ar.auth.changePassword}
      </Button>
    </form>
  )
}
