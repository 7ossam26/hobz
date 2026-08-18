// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DataTable,
  defaultHiddenColumns,
} from '@/components/shared/data-table/data-table'
import { DEFAULT_TABLE_STATE } from '@/components/shared/data-table/state'
import type {
  ColumnDef,
  FacetDef,
  TableState,
} from '@/components/shared/data-table/types'
import { ar } from '@/i18n/ar'
import { fireEvent, render, screen, within } from '@tests/helpers/render'

/**
 * `DataTable` is server-driven: it renders the answer the server already gave,
 * and turns an interaction into a **new URL** for the server to answer again.
 *
 * So the assertions below are mostly about the URL. `router.replace` is the
 * component's entire output for sorting, filtering, paging and column
 * visibility — if the query string is right, the Server Component runs the
 * right query, and if it is wrong the user is looking at the wrong rows.
 *
 * The other thing under test is RTL, which cannot be checked by eye in CI:
 * every cell aligns to the inline start unless the column asked for the end.
 */

const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/tasks',
}))

interface Row {
  id: string
  title: string
  status: string
  value: string
}

const ROWS: Row[] = [
  { id: '1', title: 'تصميم صفحة الهبوط', status: 'ASSIGNED', value: '1500.00' },
  { id: '2', title: 'مراجعة النصوص', status: 'IN_PROGRESS', value: '900.00' },
  { id: '3', title: 'مونتاج الفيديو', status: 'DONE', value: '2400.00' },
]

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'title',
    header: 'المهمة',
    sortable: true,
    hideable: false,
    cell: (row) => row.title,
  },
  { id: 'status', header: 'الحالة', cell: (row) => row.status },
  {
    id: 'value',
    header: 'القيمة',
    align: 'end',
    sortable: true,
    cell: (row) => row.value,
  },
  { id: 'due', header: 'التسليم', defaultHidden: true, cell: () => '—' },
]

const FACETS: FacetDef[] = [
  {
    id: 'status',
    label: 'الحالة',
    options: [
      { value: 'ASSIGNED', label: 'مسنَدة', hue: 'sky' },
      { value: 'DONE', label: 'منتهية', hue: 'lime', count: 4 },
    ],
  },
]

function renderTable(
  state: Partial<TableState> = {},
  props: Record<string, unknown> = {},
) {
  return render(
    <DataTable
      id="tasks"
      columns={COLUMNS}
      rows={ROWS}
      total={137}
      state={{ ...DEFAULT_TABLE_STATE, ...state }}
      rowKey={(row) => row.id}
      facets={FACETS}
      {...props}
    />,
  )
}

/** The query string of the last `router.replace`. */
const lastQuery = (): URLSearchParams => {
  const url = replace.mock.calls.at(-1)?.[0] as string
  return new URLSearchParams(url.split('?')[1] ?? '')
}

beforeEach(() => replace.mockClear())

describe('DataTable rendering', () => {
  it('يرسم الصفوف التي أعطاها له الخادم فقط', () => {
    renderTable()
    // 137 rows exist; 3 were sent. The table never invents the rest.
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1)
    expect(screen.getByText('تصميم صفحة الهبوط')).toBeInTheDocument()
  })

  it('يخفي الأعمدة المخفية ولا يرسم خلاياها', () => {
    renderTable({ hidden: ['status'] })
    expect(screen.queryByRole('columnheader', { name: 'الحالة' })).not.toBeInTheDocument()
    expect(screen.queryByText('ASSIGNED')).not.toBeInTheDocument()
  })

  it('defaultHiddenColumns تعطي الصفحة قائمة البدء الصحيحة', () => {
    // One source of truth for visibility: the page seeds `hidden`, and the
    // table reads only that.
    expect(defaultHiddenColumns(COLUMNS)).toEqual(['due'])
  })

  it('يحاذي كل خلية إلى بداية السطر إلا ما طلب النهاية', () => {
    // RTL correctness, asserted rather than eyeballed: `text-start` mirrors,
    // `text-left` would not.
    renderTable()
    const firstRow = screen.getAllByRole('row')[1]!
    const cells = within(firstRow).getAllByRole('cell')

    expect(cells[0]).toHaveClass('text-start')
    expect(cells[2]).toHaveClass('text-end')
  })

  it('يعلن اتجاه الترتيب الحالي لقارئ الشاشة', () => {
    renderTable({ sort: 'value', dir: 'desc' })

    expect(screen.getByRole('columnheader', { name: /القيمة/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(screen.getByRole('columnheader', { name: /المهمة/ })).toHaveAttribute(
      'aria-sort',
      'none',
    )
  })

  it('يعرض المدى والإجمالي بدل تركهما للاستنتاج', () => {
    renderTable({ page: 2 })
    expect(
      screen.getByText(
        ar.table.range
          .replace('{from}', '26')
          .replace('{to}', '50')
          .replace('{total}', '137'),
      ),
    ).toBeInTheDocument()
  })
})

describe('DataTable → URL', () => {
  it('النقر على رأس العمود يكتب الترتيب في العنوان', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /المهمة/ }))

    expect(lastQuery().get('sort')).toBe('title')
  })

  it('الترتيب ثلاثي الحالات ينتهي بإلغاء الترتيب', () => {
    renderTable({ sort: 'title', dir: 'desc' })
    fireEvent.click(screen.getByRole('button', { name: /المهمة/ }))

    expect(lastQuery().has('sort')).toBe(false)
  })

  it('اختيار قيمة تصفية يكتبها بالبادئة f_ ويعود للصفحة الأولى', () => {
    renderTable({ page: 5 })

    fireEvent.click(screen.getByRole('button', { name: /الحالة/ }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /مسنَدة/ }))

    const query = lastQuery()
    expect(query.get('f_status')).toBe('ASSIGNED')
    // Narrowing while on page 5 would land the user on an empty screen.
    expect(query.has('page')).toBe(false)
  })

  it('إخفاء عمود يكتبه في العنوان', () => {
    renderTable()

    fireEvent.click(screen.getByRole('button', { name: ar.table.columns }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'الحالة' }))

    expect(lastQuery().get('hide')).toBe('status')
  })

  it('لا يعرض العمود غير القابل للإخفاء في قائمة الأعمدة', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: ar.table.columns }))

    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'المهمة' }),
    ).not.toBeInTheDocument()
  })

  it('التنقل بين الصفحات يكتب رقم الصفحة', () => {
    renderTable({ page: 2 })
    fireEvent.click(screen.getByRole('button', { name: ar.table.nextPage }))

    expect(lastQuery().get('page')).toBe('3')
  })

  it('يعطّل التنقل عند حدّي الصفحات', () => {
    renderTable({ page: 1 })
    expect(screen.getByRole('button', { name: ar.table.previousPage })).toBeDisabled()
    expect(screen.getByRole('button', { name: ar.table.firstPage })).toBeDisabled()
  })

  it('تغيير حجم الصفحة يكتبه ويعود للصفحة الأولى', () => {
    renderTable({ page: 4 })
    fireEvent.change(screen.getByLabelText(ar.table.rowsPerPage), {
      target: { value: '50' },
    })

    const query = lastQuery()
    expect(query.get('size')).toBe('50')
    expect(query.has('page')).toBe(false)
  })

  it('يستبدل العنوان ولا يكدّس سجل التصفح', () => {
    // Forty sort clicks must not bury the previous page forty entries deep.
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /المهمة/ }))

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/tasks'), {
      scroll: false,
    })
  })
})

describe('DataTable empty states', () => {
  it('يفرّق بين «لا توجد بيانات» و«لا توجد نتائج للتصفية»', () => {
    // Offering "create your first task" to someone who filtered 200 tasks down
    // to zero is how a product teaches people not to trust it.
    const { unmount } = render(
      <DataTable
        id="tasks"
        columns={COLUMNS}
        rows={[]}
        total={0}
        state={DEFAULT_TABLE_STATE}
        rowKey={(row: Row) => row.id}
      />,
    )
    expect(screen.getByText(ar.table.empty)).toBeInTheDocument()
    unmount()

    render(
      <DataTable
        id="tasks"
        columns={COLUMNS}
        rows={[]}
        total={0}
        state={{ ...DEFAULT_TABLE_STATE, filters: { status: ['DONE'] } }}
        rowKey={(row: Row) => row.id}
      />,
    )
    expect(screen.getByText(ar.table.emptyFiltered)).toBeInTheDocument()
  })

  it('حالة الفراغ بعد التصفية تعرض إجراء مسح التصفية', () => {
    render(
      <DataTable
        id="tasks"
        columns={COLUMNS}
        rows={[]}
        total={0}
        state={{ ...DEFAULT_TABLE_STATE, search: 'أحمد' }}
        rowKey={(row: Row) => row.id}
      />,
    )

    fireEvent.click(
      within(screen.getByText(ar.table.emptyFiltered).closest('div')!).getByRole(
        'button',
        {
          name: ar.table.clearFilters,
        },
      ),
    )

    expect(lastQuery().has('q')).toBe(false)
  })
})

describe('DataTable rows as entry points', () => {
  it('الصف قابل للنقر وللوصول بلوحة المفاتيح عند وجود onRowClick', () => {
    // Rows open a sheet (CLAUDE.md's sheet-first model), so a row is a control
    // and must be reachable without a mouse.
    const onRowClick = vi.fn()
    renderTable({}, { onRowClick })

    const row = screen.getAllByRole('button').find((el) => el.tagName === 'TR')!
    expect(row).toHaveAttribute('tabIndex', '0')

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0])

    fireEvent.click(row)
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  it('الصف ليس عنصر تحكم بغير onRowClick', () => {
    renderTable()
    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('tabIndex')
  })
})
