import type { Metadata } from 'next'
import { Suspense } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ar } from '@/i18n/ar'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: ar.auth.signIn }

/**
 * Invite-only: there is no "create an account" link, because there is no
 * self-signup and no email to send an invitation to (SPEC §2). The page says so
 * rather than leaving a new hire clicking around looking for one.
 */
export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{ar.auth.signIn}</CardTitle>
        <CardDescription>{ar.auth.signInHint}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* `useSearchParams` (for callbackUrl) needs a Suspense boundary or the
            whole route opts out of static rendering. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <p className="text-muted-foreground border-t pt-3 text-center text-xs">
          {ar.auth.noSelfSignup}
        </p>
      </CardContent>
    </Card>
  )
}
