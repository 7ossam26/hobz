'use server'

import { revalidatePath } from 'next/cache'

import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'
import { invalidateSettingsCache } from '@/lib/settings'

import { updateSettingSchema, updateSettingsSchema } from './schema'
import { updateSetting } from './service'
import type { SettingDto } from './types'

/**
 * modules/setting/actions.ts — the reference server action.
 *
 * Every action in this codebase has exactly this shape, in exactly this order
 * (CLAUDE.md invariant 3):
 *
 *   1. session      — requireActor()
 *   2. permission   — assertCan()
 *   3. validation   — schema.parse()
 *   4. service      — the pure, injected function that does the work
 *   5. cache        — revalidate / invalidate
 *
 * Actions stay thin. No business logic lives here, so that everything worth
 * testing is reachable from a unit test without Next.js in the way.
 */

export async function updateSettingAction(raw: unknown): Promise<SettingDto> {
  const actor = await requireActor()
  assertCan(actor, 'settings.edit')

  const input = updateSettingSchema.parse(raw)

  const result = await updateSetting(prisma, {
    actor,
    key: input.key,
    value: input.value,
  })

  // Only after the write has committed — see the note in service.updateSetting.
  invalidateSettingsCache()
  revalidatePath('/settings')

  return result
}

export async function updateSettingsAction(raw: unknown): Promise<SettingDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'settings.edit')

  const input = updateSettingsSchema.parse(raw)

  // All-or-nothing: a settings page that saved half its fields would leave the
  // business rules in a state no one chose.
  const results = await prisma.$transaction(async (tx) => {
    const written: SettingDto[] = []
    for (const update of input.updates) {
      written.push(
        await updateSetting(tx, { actor, key: update.key, value: update.value }),
      )
    }
    return written
  })

  invalidateSettingsCache()
  revalidatePath('/settings')

  return results
}
