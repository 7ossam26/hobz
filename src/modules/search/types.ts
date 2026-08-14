/** One searchable record in the command palette. */
export interface CommandEntity {
  kind: 'user' | 'role'
  id: string
  /** What the user reads and searches by. */
  label: string
  /** Secondary line — a username, a member count. */
  sublabel?: string
  /** Also matched against, but never displayed. */
  keywords?: string[]
  href: string
}

export interface CommandDirectory {
  users: CommandEntity[]
  roles: CommandEntity[]
}
