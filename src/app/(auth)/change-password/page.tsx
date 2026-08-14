import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { getSessionState } from '@/lib/auth/session'

import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = { title: ar.auth.changePassword }

/**
 * Lives under `(auth)` rather than `(app)` on purpose. When the change is
 * forced, the app shell is exactly what the user must not be able to browse —
 * rendering the sidebar around a blocking form would invite them to click past
 * it. The route is still authenticated; it just does not get the chrome.
 */
export default async function ChangePasswordPage() {
  const { actor, mustChangePassword } = await getSessionState()
  if (!actor) redirect('/login')

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {mustChangePassword ? ar.auth.mustChangePassword : ar.auth.changePassword}
        </CardTitle>
        <CardDescription>{ar.auth.forgotPassword}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePasswordForm forced={mustChangePassword} />
      </CardContent>
    </Card>
  )
}
