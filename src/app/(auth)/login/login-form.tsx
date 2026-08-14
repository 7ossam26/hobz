'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

import { FormField } from '@/components/shared/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ar } from '@/i18n/ar'
import { loginAction, type ActionMessage } from '@/modules/auth/actions'

/**
 * The login form.
 *
 * The server action returns a message *key*, never Arabic prose, and this
 * component resolves it against `ar` — which is what keeps the "no Arabic
 * literals outside src/i18n" rule true across the client/server boundary
 * (CLAUDE.md UI rules).
 */

function resolveMessage(message: ActionMessage): string {
  const [section, key] = message.messageKey.split('.')
  const table = (ar as unknown as Record<string, Record<string, string>>)[section ?? '']
  const text = table?.[key ?? ''] ?? ar.errors.unexpected

  return Object.entries(message.params ?? {}).reduce(
    (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
    text,
  )
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await loginAction({
        username: String(data.get('username') ?? ''),
        password: String(data.get('password') ?? ''),
      })

      if (!result.ok) {
        setError(resolveMessage(result))
        return
      }

      // `refresh()` before `push()`: the layout is a Server Component and would
      // otherwise render from the signed-out cache entry for one frame.
      const target = searchParams.get('callbackUrl') ?? '/dashboard'
      router.replace(target)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormField name="username" label={ar.auth.username} required>
        {(field) => (
          <Input
            {...field}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            // The username is a Latin identifier; forcing LTR stops the caret
            // and any typed characters from being reordered inside an RTL page.
            dir="ltr"
            className="text-start"
          />
        )}
      </FormField>

      <FormField name="password" label={ar.auth.password} required>
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

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? ar.auth.signingIn : ar.auth.signIn}
      </Button>

      <p className="text-muted-foreground text-center text-xs">
        {ar.auth.forgotPassword}
      </p>
    </form>
  )
}
