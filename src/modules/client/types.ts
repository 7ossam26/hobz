/** What a read path returns. Never the raw Prisma row. */
export interface ClientSummaryDto {
  id: string
  name: string
  phone: string | null
  notes: string | null
  /** Non-deleted projects referencing this client. Server-computed. */
  projectCount: number
  createdAt: Date
}

export type ClientDetailDto = ClientSummaryDto

export interface ClientPageDto {
  items: ClientSummaryDto[]
  total: number
  page: number
  pageSize: number
}
