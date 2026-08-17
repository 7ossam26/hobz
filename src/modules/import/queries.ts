import { requireActor } from '@/lib/auth/session'
import { assertCan } from '@/lib/rbac'

import { importEntitySchema, type ImportEntity } from './schema'
import { buildImportTemplateWorkbook } from './template'

/**
 * modules/import/queries.ts — the one read path, behind `import.run` (SPEC
 * §10 item 6). A template carries no data, but the column list it documents
 * (and, for `tasks`/`projects`, the live Settings taxonomy it embeds as
 * dropdowns) is still only for someone permitted to run the import it feeds.
 */
export async function getImportTemplate(entity: ImportEntity): Promise<Buffer> {
  const actor = await requireActor()
  assertCan(actor, 'import.run')
  return buildImportTemplateWorkbook(importEntitySchema.parse(entity))
}
