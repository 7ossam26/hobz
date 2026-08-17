'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'

import { importEntitySchema } from './schema'
import { confirmImport, previewImport } from './service'
import type { ImportConfirmActionResult, ImportPreviewActionResult } from './types'

/**
 * Thin server actions: session → permission → zod → service (CLAUDE.md
 * invariant 3). Both take a `FormData` — the file the wizard's `<input
 * type="file">` already holds in memory, never written to disk — rather than
 * `raw: unknown`, because a `File` only survives the Server Action boundary
 * inside `FormData`.
 *
 * Neither throws for an expected, file-shaped problem (wrong template, empty
 * file, too many rows): a thrown `AppError`'s message is stripped crossing
 * this boundary in production (the lesson `modules/auth/actions.ts` already
 * recorded), so both return `{ok:false, messageKey, params}` instead and let
 * the wizard resolve it against `ar` client-side.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

function fileFrom(formData: FormData): File | null {
  const file = formData.get('file')
  return file instanceof File ? file : null
}

function messageFrom(error: unknown): {
  ok: false
  messageKey: string
  params?: Record<string, string | number>
} {
  if (isAppError(error)) {
    return {
      ok: false,
      messageKey: error.messageKey,
      params: (error.details ?? {}) as Record<string, string | number>,
    }
  }
  throw error
}

export const previewImportAction = requirePermission(
  'import.run',
  async (actor, formData: FormData): Promise<ImportPreviewActionResult> => {
    const entity = importEntitySchema.parse(formData.get('entity'))
    const file = fileFrom(formData)
    if (!file) return { ok: false, messageKey: 'import.errors.fileRequired' }

    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const preview = await previewImport(prisma, { entity, buffer, actor })
      return { ok: true, preview }
    } catch (error) {
      return messageFrom(error)
    }
  },
)

export const confirmImportAction = requirePermission(
  'import.run',
  async (actor, formData: FormData): Promise<ImportConfirmActionResult> => {
    const entity = importEntitySchema.parse(formData.get('entity'))
    const file = fileFrom(formData)
    if (!file) return { ok: false, messageKey: 'import.errors.fileRequired' }

    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const clientIp = await ip()
      // A row cap of 500, each a full create/update service call, comfortably
      // outruns Prisma's 5s interactive-transaction default — bounded well
      // under Postgres's own idle-in-transaction timeout regardless.
      const result = await prisma.$transaction(
        (tx) => confirmImport(tx, { entity, buffer, actor, ip: clientIp }),
        { timeout: 120_000, maxWait: 10_000 },
      )

      revalidatePath('/users')
      revalidatePath('/clients')
      revalidatePath('/projects')
      revalidatePath('/tasks')
      revalidatePath('/import')

      return { ok: true, result }
    } catch (error) {
      return messageFrom(error)
    }
  },
)
