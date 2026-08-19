'use client'

import { Wallet } from 'lucide-react'
import * as React from 'react'

import { Chip } from '@/components/data/chip'
import { DateText } from '@/components/data/date-text'
import { MoneyText } from '@/components/data/money-text'
import { EmptyState } from '@/components/shared/empty-state'
import { Sheet } from '@/components/shared/sheet'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { ledgerTypeHue } from '@/lib/palette'
import type { LedgerPageDto } from '@/modules/ledger/types'
import type { PayoutStatementDto } from '@/modules/payout/types'

/**
 * The interactive half of مستحقاتي: the statement sheet.
 *
 * Sheet-first (CLAUDE.md UI rules) — a منفّذ opening a past cycle stays on the
 * page they were reading. Nothing here fetches: the server already handed down
 * every statement, because a client-side waterfall for data the page was
 * rendered from is exactly what SPEC §9's performance budget forbids.
 */
export function EarningsClient({
  ledger,
  statements,
}: {
  ledger: LedgerPageDto
  statements: PayoutStatementDto[]
}) {
  const [open, setOpen] = React.useState<PayoutStatementDto | null>(null)

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{ar.payouts.cycles}</h2>
        {statements.length === 0 ? (
          <EmptyState
            title={ar.payouts.empty}
            description={ar.payouts.emptyHint}
            icon={<Wallet aria-hidden className="size-5" />}
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {statements.map((statement) => (
              <li key={statement.payout.id}>
                <button
                  type="button"
                  onClick={() => setOpen(statement)}
                  className="border-border hover:bg-accent flex w-full flex-col gap-2 rounded-lg border p-3 text-start transition-colors"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      <DateText value={statement.cycle.periodEnd} variant="full" />
                    </span>
                    <PayoutStatusChip status={statement.payout.status} />
                  </span>
                  <MoneyText
                    value={statement.payout.net}
                    withCurrency
                    className="text-lg"
                  />
                  {Number(statement.payout.outstanding) > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {ar.payouts.outstanding}:{' '}
                      <MoneyText value={statement.payout.outstanding} />
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{ar.ledger.title}</h2>
        {ledger.items.length === 0 ? (
          <EmptyState
            title={ar.ledger.empty}
            description={ar.ledger.emptyHint}
            icon={<Wallet aria-hidden className="size-5" />}
          />
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ar.ledger.date}</TableHead>
                  <TableHead>{ar.ledger.type}</TableHead>
                  <TableHead>{ar.ledger.note}</TableHead>
                  <TableHead className="text-end">{ar.ledger.amount}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.items.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-reversed={entry.reversedByEntryId ?? undefined}
                  >
                    <TableCell className="whitespace-nowrap">
                      <DateText value={entry.createdAt} variant="short" />
                    </TableCell>
                    <TableCell>
                      <Chip hue={ledgerTypeHue(entry.type)} size="sm">
                        {ar.enums.ledgerType[entry.type]}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[28ch] truncate text-sm">
                      {entry.note}
                      {entry.reversedByEntryId ? (
                        <span className="text-muted-foreground/80 ms-2 text-xs">
                          ({ar.ledger.reversed})
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end">
                      <MoneyText value={entry.amount} tone="ledger" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Sheet
        open={open !== null}
        onClose={() => setOpen(null)}
        title={ar.payouts.statement}
        {...(open ? { description: `${ar.payouts.period}: ${formatPeriod(open)}` } : {})}
        footer={
          <Button type="button" variant="secondary" onClick={() => setOpen(null)}>
            {ar.common.close}
          </Button>
        }
      >
        {open ? <StatementBody statement={open} /> : null}
      </Sheet>
    </>
  )
}

function formatPeriod(statement: PayoutStatementDto): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    dateStyle: 'medium',
    timeZone: 'Africa/Cairo',
  }).format(statement.cycle.periodEnd)
}

function PayoutStatusChip({
  status,
}: {
  status: PayoutStatementDto['payout']['status']
}) {
  // `neutral` for DRAFT: nothing has been decided about it yet, and SPEC §9
  // reserves saturated colour for data that carries state.
  const hue = status === 'PAID' ? 'emerald' : status === 'APPROVED' ? 'sky' : 'neutral'
  return (
    <Chip hue={hue} size="sm">
      {ar.enums.payoutStatus[status]}
    </Chip>
  )
}

/**
 * The arithmetic, line by line, in the order SPEC §5.5 states it. This is the
 * screen CLAUDE.md's one-sentence purpose is about — "make deductions and
 * payments feel like arithmetic, not like the manager's mood" — so every term
 * that moved the number is shown, including the one carried in from last month.
 */
function StatementBody({ statement }: { statement: PayoutStatementDto }) {
  const { payout } = statement
  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: ar.payouts.carriedForward, value: payout.carriedForward },
    { label: ar.payouts.gross, value: payout.gross },
    { label: ar.payouts.penalties, value: `-${payout.penalties}` },
    { label: ar.payouts.bonuses, value: payout.bonuses },
    { label: ar.payouts.advances, value: `-${payout.advances}` },
    { label: ar.payouts.adjustments, value: payout.adjustments },
  ]

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>
              <MoneyText value={row.value} tone="ledger" />
            </dd>
          </div>
        ))}
        <div className="border-border mt-1 flex items-center justify-between gap-4 border-t pt-3">
          <dt className="font-medium">{ar.payouts.net}</dt>
          <dd>
            <MoneyText value={payout.net} withCurrency className="text-lg" />
          </dd>
        </div>
        {Number(payout.paidAmount) > 0 || payout.status !== 'DRAFT' ? (
          <>
            <div className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{ar.payouts.paidAmount}</dt>
              <dd>
                <MoneyText value={payout.paidAmount} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{ar.payouts.outstanding}</dt>
              <dd>
                <MoneyText value={payout.outstanding} />
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {Number(payout.net) === 0 && Number(payout.carriedForward) < 0 ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-xs">
          {ar.payouts.flooredAtZero}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{ar.payouts.breakdownHint}</p>

      {payout.method ? (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{ar.payouts.method}</dt>
            <dd>{payout.method}</dd>
          </div>
          {payout.reference ? (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{ar.payouts.reference}</dt>
              <dd dir="ltr">{payout.reference}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}
