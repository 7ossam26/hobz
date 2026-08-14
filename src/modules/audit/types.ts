export interface AuditActorDto {
  id: string
  fullName: string
  username: string
}

export interface AuditEntryDto {
  id: string
  action: string
  entity: string
  entityId: string
  /** Null for scheduler/system actions. */
  actor: AuditActorDto | null
  /** Present only when the action was taken while impersonating. */
  impersonator: AuditActorDto | null
  before: unknown
  after: unknown
  reason: string | null
  ip: string | null
  createdAt: Date
}

export interface AuditPageDto {
  items: AuditEntryDto[]
  total: number
  page: number
  pageSize: number
}

/** One row of the before/after diff view. */
export interface AuditDiffRow {
  field: string
  kind: 'added' | 'removed' | 'changed'
  before: unknown
  after: unknown
}

/** The distinct values present in the log, for populating the filter dropdowns. */
export interface AuditFacetsDto {
  actors: AuditActorDto[]
  entities: string[]
  actions: string[]
}
