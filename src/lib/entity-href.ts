/**
 * Canonical deep links for entities that open in sheets.
 *
 * A task has no detail page by design. Its id rides on the list route, whose
 * client shell resolves it through the same scoped `EntitySheet` action used
 * by a row click.
 */
export function taskHref(taskId: string): string {
  return `/tasks?task=${encodeURIComponent(taskId)}`
}
