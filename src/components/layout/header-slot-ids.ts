/**
 * The DOM ids the header's portal anchors use.
 *
 * In their own module because the anchors are rendered by a Server Component
 * and filled by a Client Component. Importing the client file to get a string
 * constant would pull the whole portal into the server graph.
 */
export const HEADER_SLOT_IDS = {
  actions: 'header-slot-actions',
  breadcrumb: 'header-slot-breadcrumb',
} as const
