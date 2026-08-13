import { Button } from '@/components/ui/button'
import { ar } from '@/i18n/ar'
import { format } from '@/lib/money'

/**
 * Phase 0 foundation check — deliberately not a product screen.
 *
 * It exists to prove four things end to end, and nothing more:
 *   1. IBM Plex Sans Arabic is served locally and applied.
 *   2. `dir="rtl"` flows correctly and logical properties (`ms-*`/`pe-*`) work.
 *   3. shadcn/ui renders correctly under RTL.
 *   4. `lib/money.format` produces Arabic-locale text with Western digits.
 *
 * Phase 2 replaces this route with the real app shell.
 */
export default function FoundationPage() {
  const samples = ['1234.5', '-99.05', '0', '1000000'] as const

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2 border-b pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{ar.app.name}</h1>
        <p className="text-muted-foreground text-sm">{ar.app.tagline}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{ar.common.details}</h2>
        {/* `ps-4` + `border-s` are logical: they land on the right under RTL. */}
        <ul className="border-primary flex flex-col gap-1 border-s-2 ps-4 text-sm">
          <li>{ar.enums.taskStatus.IN_PROGRESS}</li>
          <li>{ar.enums.priority.URGENT}</li>
          <li>{ar.enums.ledgerType.PENALTY}</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{ar.enums.ledgerType.PAYOUT}</h2>
        <dl className="flex flex-col gap-1 text-sm">
          {samples.map((value) => (
            <div key={value} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground font-mono text-xs">{value}</dt>
              <dd className="tabular-nums" dir="ltr">
                {format(value, { withCurrency: true })}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center gap-3">
        <Button>{ar.common.save}</Button>
        <Button variant="secondary">{ar.common.cancel}</Button>
        <Button variant="destructive">{ar.common.delete}</Button>
      </section>
    </main>
  )
}
