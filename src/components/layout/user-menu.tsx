'use client'

import { KeyRound, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { logoutAction } from '@/modules/auth/actions'

/**
 * Identity and the two things you can do with it. Deliberately not a dropdown:
 * two links do not justify a popover's client JS, and Phase 2 owns the real
 * user menu.
 */
export function UserMenu({
  fullName,
  username,
}: {
  fullName: string
  username: string
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end leading-tight">
        <span className="text-sm font-medium">{fullName}</span>
        <span className="text-muted-foreground text-xs" dir="ltr">
          {username}
        </span>
      </div>

      <Button asChild variant="ghost" size="icon-sm" title={ar.auth.changePassword}>
        <Link href="/change-password" aria-label={ar.auth.changePassword}>
          <KeyRound />
        </Link>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={ar.auth.signOut}
        title={ar.auth.signOut}
        onClick={() => {
          startTransition(async () => {
            await logoutAction()
          })
        }}
      >
        <LogOut />
      </Button>
    </div>
  )
}
