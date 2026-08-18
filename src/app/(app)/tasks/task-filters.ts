import type { TableState } from '@/components/shared/data-table/types'

/**
 * One filter shape, shared by all three task views.
 *
 * `TableState.filters` is a generic `Record<string, string[]>` (`components/
 * shared/data-table/state.ts`) because the URL cannot carry typed data. This
 * is the single place that reads it back into the shape `listTasksSchema`
 * (`modules/task/schema.ts`) actually validates — board, list and calendar
 * all call through here, so a facet added once behaves identically in all
 * three instead of being reinterpreted per view.
 *
 * Boolean facets (`overdueOnly`, `dueSoon`) are modelled as a one-option
 * facet, present or absent, rather than a special-cased control — the same
 * `FacetFilter` checkbox list every other facet uses.
 */
export interface TaskQueryFilters {
  search?: string
  projectId?: string[]
  assigneeId?: string[]
  status?: string[]
  priority?: string[]
  categoryId?: string[]
  overdueOnly?: boolean
  dueSoon?: boolean
}

export const BOOLEAN_FACET_VALUE = 'true'

export function toTaskQueryFilters(state: TableState): TaskQueryFilters {
  return {
    ...(state.search ? { search: state.search } : {}),
    ...(state.filters.project?.length ? { projectId: state.filters.project } : {}),
    ...(state.filters.assignee?.length ? { assigneeId: state.filters.assignee } : {}),
    ...(state.filters.status?.length ? { status: state.filters.status } : {}),
    ...(state.filters.priority?.length ? { priority: state.filters.priority } : {}),
    ...(state.filters.category?.length ? { categoryId: state.filters.category } : {}),
    ...(state.filters.overdueOnly?.includes(BOOLEAN_FACET_VALUE)
      ? { overdueOnly: true }
      : {}),
    ...(state.filters.dueSoon?.includes(BOOLEAN_FACET_VALUE) ? { dueSoon: true } : {}),
  }
}
