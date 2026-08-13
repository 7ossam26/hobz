import { requireActor } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { assertCan } from '@/lib/rbac'

import { listSettings, listSettingsByGroup } from './service'
import type { SettingDto, SettingGroupDto } from './types'

/**
 * modules/setting/queries.ts — read paths, with the permission check baked in
 * (CLAUDE.md invariant 3).
 *
 * The check lives here rather than in the page because the page is not the only
 * caller. Any Server Component, action, or future report that reads settings
 * goes through this function and is therefore checked. Hiding the settings nav
 * item is cosmetic; this is the enforcement.
 *
 * Settings are global, so there is no row-level scoping to apply. Modules with
 * `view.all` / `view.assigned` semantics (projects, tasks) additionally spread
 * `scopeProjects(actor)` / `scopeTasks(actor)` into their `where` clause here.
 */

export async function getSettings(): Promise<SettingDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'settings.view')
  return listSettings(prisma)
}

export async function getSettingsByGroup(): Promise<SettingGroupDto[]> {
  const actor = await requireActor()
  assertCan(actor, 'settings.view')
  return listSettingsByGroup(prisma)
}
