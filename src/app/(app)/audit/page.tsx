import type { Metadata } from 'next'
import { Suspense } from 'react'

import { EmptyState } from '@/components/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { getAuditEntries, getAuditFacets } from '@/modules/audit/queries'

import { AuditDiff } from './audit-diff'
import { AuditFilters } from './audit-filters'

export const metadata: Metadata = { title: ar.audit.title }

/** Gregorian date, Arabic month names, Western digits, Cairo (SPEC §2). */
const dateFormatter = new Intl.DateTimeFormat('ar-EG-u-nu-latn-ca-gregory', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Cairo',
})

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  // Both calls assert `audit.view` themselves. The facets are gated too: the
  // list of everyone who has ever acted in the system is itself information.
  const [page, facets] = await Promise.all([
    getAuditEntries({
      actorId: params.actorId,
      entity: params.entity,
      action: params.action,
      from: params.from,
      to: params.to,
      page: params.page ? Number(params.page) : 1,
      pageSize: 50,
    }),
    getAuditFacets(),
  ])

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{ar.audit.title}</h1>
        <p className="text-muted-foreground text-sm">{ar.audit.subtitle}</p>
      </header>

      <Suspense fallback={null}>
        <AuditFilters facets={facets} />
      </Suspense>

      {page.items.length === 0 ? (
        <EmptyState title={ar.audit.empty} />
      ) : (
        <>
          <p className="text-muted-foreground text-xs tabular-nums">
            {page.total} {ar.common.results}
          </p>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">{ar.audit.date}</TableHead>
                  <TableHead className="w-44">{ar.audit.actor}</TableHead>
                  <TableHead className="w-52">{ar.audit.action}</TableHead>
                  <TableHead className="w-40">{ar.audit.entity}</TableHead>
                  <TableHead>{ar.audit.diff}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((entry) => (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                      {dateFormatter.format(entry.createdAt)}
                    </TableCell>

                    <TableCell className="text-xs">
                      {entry.actor ? (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{entry.actor.fullName}</span>
                          {entry.impersonator ? (
                            // Both identities, every time (SPEC Phase 1 §5).
                            <Badge variant="warning">
                              {ar.audit.viaImpersonation}: {entry.impersonator.fullName}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{ar.audit.system}</span>
                      )}
                      {entry.ip ? (
                        <div
                          className="text-muted-foreground mt-0.5 font-mono text-[11px]"
                          dir="ltr"
                        >
                          {entry.ip}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-xs">
                      <span className="font-medium">
                        {ar.auditActions[entry.action as keyof typeof ar.auditActions] ??
                          entry.action}
                      </span>
                      {entry.reason ? (
                        <div className="text-muted-foreground mt-0.5">
                          {ar.audit.reason}: {entry.reason}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-xs">
                      <div className="font-mono" dir="ltr">
                        {entry.entity}
                      </div>
                      <div
                        className="text-muted-foreground font-mono text-[11px]"
                        dir="ltr"
                      >
                        {entry.entityId}
                      </div>
                    </TableCell>

                    <TableCell>
                      <AuditDiff entry={entry} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
