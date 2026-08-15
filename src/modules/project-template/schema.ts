import { z } from 'zod'

import { ar } from '@/i18n/ar'
import { projectCoreShape, refineDateOrder } from '@/modules/project/schema'

/** One Zod schema per input, shared between the server action and the form (SPEC §3). */

export const saveProjectAsTemplateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, ar.validation.required).max(160),
})
export type SaveProjectAsTemplateInput = z.infer<typeof saveProjectAsTemplateSchema>

/**
 * Everything `createProjectSchema` needs — the template only supplies the
 * milestone structure, not the project-level fields (client, owner, dates,
 * engagement type), which still come from whoever is creating the new project.
 */
export const createProjectFromTemplateSchema = z
  .object({
    templateId: z.string().min(1),
    code: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    ...projectCoreShape,
  })
  .superRefine(refineDateOrder)

export type CreateProjectFromTemplateInput = z.infer<
  typeof createProjectFromTemplateSchema
>

export const templateIdSchema = z.object({ id: z.string().min(1) })
