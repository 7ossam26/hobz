import { z } from 'zod'

/**
 * modules/import/schema.ts — SPEC §10: `.xlsx` only, four entities.
 */

export const IMPORT_ENTITIES = ['users', 'clients', 'projects', 'tasks'] as const
export type ImportEntity = (typeof IMPORT_ENTITIES)[number]

export const importEntitySchema = z.enum(IMPORT_ENTITIES)

export const importRequestSchema = z.object({
  entity: importEntitySchema,
})
export type ImportRequestInput = z.infer<typeof importRequestSchema>
