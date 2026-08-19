'use client'

import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { stopImpersonationAction } from '@/modules/impersonation/actions'

/**
 * The impersonation banner.
 *
 * Loud on purpose, and never dismissable. A SUPER_ADMIN who forgets they are
 * viewing as someone else will eventually take a real action believing it is
 * their own — and the audit row will say the impersonated user did it. Amber
 * rather than the violet accent, because this is a state warning and colour
 * encodes data (SPEC §9).
 */
export function ImpersonationBanner({ impersonatedName }: { impersonatedName: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <div
      role="status"
      data-hue="amber"
      className="bg-hue-surface text-hue-text border-hue-line flex items-center justify-between gap-4 border-b px-4 py-2"
    >
      <div className="flex items-center gap-2.5">
        <Eye className="size-4 shrink-0" aria-hidden />
        <div className="flex flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-medium">
            {ar.impersonation.banner.replace('{name}', impersonatedName)}
          </span>
          <span className="text-xs opacity-80">{ar.impersonation.bannerHint}</span>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="border-hue-line hover:bg-hue-surface"
        onClick={() => {
          startTransition(async () => {
            await stopImpersonationAction()
            router.refresh()
          })
        }}
      >
        {ar.impersonation.stop}
      </Button>
    </div>
  )
}
