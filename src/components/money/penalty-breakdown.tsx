import { Chip } from '@/components/data/chip'
import { DateText, DateTimeText } from '@/components/data/date-text'
import { MoneyText } from '@/components/data/money-text'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import type { PenaltyBreakdownDto } from '@/modules/penalty/types'

/**
 * The whole calculation, on screen.
 *
 * This component is the product's thesis rendered: CLAUDE.md asks that
 * deductions "feel like arithmetic, not like the manager's mood", and SPEC §8
 * says the منفّذ's notification must show "the full calculation breakdown: due
 * date, grace, working days late, formula, amount". The same component draws
 * both, so the figure a manager defends and the figure a منفّذ reads cannot
 * differ.
 *
 * ── Three rules it follows ────────────────────────────────────────────────
 *
 *  1. **Every input is shown, not just the answer.** A deduction whose reader
 *     has to take the number on trust is exactly what this product exists to
 *     abolish, and SPEC §5.4 gives the منفّذ no way to contest it in-system —
 *     so the arithmetic is the entire recourse they have.
 *  2. **The formula reproduces by hand.** Its terms are exact: a daily rate
 *     appears as `5,000.00 ÷ 22`, never as a rounded `227.27`
 *     (`modules/penalty/breakdown.ts`).
 *  3. **Colour encodes data, never decoration** (SPEC §9). The only hues here
 *     are the amount's own (red, via `MoneyText tone="ledger"`), the frozen /
 *     live state, and the excused-days note.
 *
 * Server component: it is a table of facts. Nothing is interactive.
 */
export function PenaltyBreakdown({
  breakdown,
  className,
  showTask = false,
}: {
  breakdown: PenaltyBreakdownDto
  className?: string
  /** The register shows which task; the task sheet already knows. */
  showTask?: boolean
}) {
  const t = ar.penalties

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip hue={breakdown.frozen ? 'neutral' : 'amber'} size="sm">
          {breakdown.frozen ? t.frozen : t.live}
        </Chip>
        {breakdown.roundIndex > 0 ? (
          <Chip hue="fuchsia" size="sm">
            {t.revisionRound.replace('{n}', String(breakdown.roundIndex))}
          </Chip>
        ) : null}
        <Chip hue="neutral" size="sm" tone="outline">
          {breakdown.profileName ?? t.profileDefault}
        </Chip>
      </div>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
        {showTask ? (
          <>
            <dt className="text-muted-foreground">{t.task}</dt>
            <dd>{breakdown.taskTitle}</dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">{t.fields.dueDate}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <DateTimeText value={breakdown.dueDate} />
          {breakdown.dueDate.getTime() !== breakdown.originalDueDate.getTime() ? (
            <span className="text-muted-foreground text-xs">
              {ar.lateness.originalDueDate}:{' '}
              <DateText value={breakdown.originalDueDate} />
            </span>
          ) : null}
        </dd>

        <dt className="text-muted-foreground">{t.fields.graceHours}</dt>
        <dd className="numeric-latn">
          {ar.lateness.graceHoursValue.replace('{hours}', String(breakdown.graceHours))}
        </dd>

        <dt className="text-muted-foreground">{t.fields.effectiveDueDate}</dt>
        <dd>
          <DateTimeText value={breakdown.effectiveDueDate} />
        </dd>

        <dt className="text-muted-foreground">{t.fields.lateWorkingDays}</dt>
        <dd className="numeric-latn">{breakdown.lateWorkingDays}</dd>

        {/*
          Shown only when it is non-zero, and shown *because* it is the
          difference between the figure on the board and the figure in the
          ledger. SPEC §5.3: a منفّذ who could not work cannot be late for not
          working, and "five days late, two of them excused" is a sentence they
          can check — "three days late" alone is one they would dispute.
        */}
        {breakdown.blockedWorkingDays > 0 ? (
          <>
            <dt className="text-muted-foreground">{t.fields.blockedWorkingDays}</dt>
            <dd className="numeric-latn" data-hue="sky">
              <span className="text-hue-text">−{breakdown.blockedWorkingDays}</span>
            </dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">{t.fields.basis}</dt>
        <dd>{t.basis[breakdown.basis]}</dd>

        <dt className="text-muted-foreground">{t.fields.formula}</dt>
        <dd dir="ltr" className="numeric-latn text-start font-medium">
          {breakdown.formula}
        </dd>

        <dt className="text-muted-foreground">{t.fields.amount}</dt>
        <dd>
          <MoneyText value={`-${breakdown.amount}`} withCurrency tone="ledger" />
        </dd>
      </dl>

      {breakdown.basisFallback ? (
        <p className="text-muted-foreground text-xs">
          {t.basisFallback.replace('{basis}', t.basis[breakdown.basis])}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{t.breakdownHint}</p>
    </div>
  )
}
