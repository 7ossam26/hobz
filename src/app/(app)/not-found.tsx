import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-14">
      <p className="text-sm font-medium">{ar.errors.notFound}</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/dashboard">{ar.nav.dashboard}</Link>
      </Button>
    </div>
  )
}
