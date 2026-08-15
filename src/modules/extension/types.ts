export type ExtensionStatusDto = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface ExtensionPersonDto {
  id: string
  fullName: string
  username: string
}

export interface ExtensionRequestDto {
  id: string
  taskId: string
  taskTitle: string
  requestedBy: ExtensionPersonDto
  /** The deadline in force when the request was made — the staleness check. */
  oldDueDate: Date
  newDueDate: Date
  reason: string
  status: ExtensionStatusDto
  decidedBy: ExtensionPersonDto | null
  decidedAt: Date | null
  decisionNote: string | null
  createdAt: Date
}

export interface ExtensionPageDto {
  items: ExtensionRequestDto[]
  total: number
  page: number
  pageSize: number
}
