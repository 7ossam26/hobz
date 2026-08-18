'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'

import { PAGE_SIZES, pageCount, pageRange } from './state'
import type { TableState } from './types'

/**
 * Pagination — server-driven, and always visible.
 *
 * The count and the range are stated in words (`عرض 26–50 من 137`) rather than
 * left to be inferred from a row of page numbers. On a list of deductions, "how
 * many are there in total" is usually the actual question.
 *
 * **The chevrons are mirrored.** Under RTL, "next" points to the inline end,
 * which is the left. `ChevronLeft` on the next-page button is therefore correct
 * here and would be a bug in an LTR product — one of the few places where the
 * physical name of an icon is the right choice.
 */
export function DataTablePagination({
  state,
  total,
  onPage,
  onPageSize,
}: {
  state: TableState
  total: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}) {
  const pages = pageCount(total, state.pageSize)
  const { from, to } = pageRange(state, total)
  const first = state.page <= 1
  const last = state.page >= pages

  return (
    <div className="text-fg-muted flex flex-wrap items-center justify-between gap-3 text-xs">
      <p className="tabular-nums" aria-live="polite">
        {ar.table.range
          .replace('{from}', String(from))
          .replace('{to}', String(to))
          .replace('{total}', String(total))}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap">{ar.table.rowsPerPage}</span>
          <Select
            value={state.pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-8 w-auto tabular-nums"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>

        <span className="whitespace-nowrap tabular-nums">
          {ar.table.pageOf
            .replace('{page}', String(state.page))
            .replace('{pages}', String(pages))}
        </span>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={first}
            onClick={() => onPage(1)}
            aria-label={ar.table.firstPage}
          >
            <ChevronsRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={first}
            onClick={() => onPage(state.page - 1)}
            aria-label={ar.table.previousPage}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={last}
            onClick={() => onPage(state.page + 1)}
            aria-label={ar.table.nextPage}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={last}
            onClick={() => onPage(pages)}
            aria-label={ar.table.lastPage}
          >
            <ChevronsLeft />
          </Button>
        </div>
      </div>
    </div>
  )
}
