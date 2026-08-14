'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'

import { clientIpFromHeaders } from '@/lib/auth/ip'
import { getPasswordPolicy } from '@/lib/auth/policy'
import { requirePermission } from '@/lib/auth/session'
import { prisma } from '@/lib/db'

import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdSchema,
} from './schema'
import {
  activateUser,
  adminResetPassword,
  createUser,
  deactivateUser,
  updateUser,
} from './service'
import type { UserDetailDto } from './types'

/**
 * Thin server actions: session → permission → zod → service → revalidate.
 * `requirePermission` enforces the first two before the body runs at all.
 */

async function ip(): Promise<string | undefined> {
  return clientIpFromHeaders(await headers())
}

export const createUserAction = requirePermission(
  'user.create',
  async (actor, raw: unknown): Promise<UserDetailDto> => {
    const input = createUserSchema.parse(raw)
    const user = await createUser(prisma, {
      actor,
      input,
      policy: await getPasswordPolicy(),
      ip: await ip(),
    })
    revalidatePath('/users')
    return user
  },
)

export const updateUserAction = requirePermission(
  'user.edit',
  async (actor, raw: unknown): Promise<UserDetailDto> => {
    const input = updateUserSchema.parse(raw)
    const user = await updateUser(prisma, { actor, input, ip: await ip() })
    revalidatePath('/users')
    // Roles may have changed, and the navigation is rendered from permissions.
    revalidatePath('/', 'layout')
    return user
  },
)

export const deactivateUserAction = requirePermission(
  'user.deactivate',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = userIdSchema.parse(raw)
    await deactivateUser(prisma, { actor, id, ip: await ip() })
    revalidatePath('/users')
  },
)

export const activateUserAction = requirePermission(
  'user.deactivate',
  async (actor, raw: unknown): Promise<void> => {
    const { id } = userIdSchema.parse(raw)
    await activateUser(prisma, { actor, id, ip: await ip() })
    revalidatePath('/users')
  },
)

export const resetUserPasswordAction = requirePermission(
  'user.resetPassword',
  async (actor, raw: unknown): Promise<void> => {
    const input = resetPasswordSchema.parse(raw)
    await adminResetPassword(prisma, {
      actor,
      id: input.id,
      newPassword: input.newPassword,
      policy: await getPasswordPolicy(),
      ip: await ip(),
    })
    revalidatePath('/users')
  },
)
