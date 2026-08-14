'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { AuthError } from 'next-auth'

import { LOGIN_ERROR_CODES } from '@/lib/auth/config'
import { refreshSessionToken } from '@/lib/auth/impersonation'
import { clientIpFromHeaders } from '@/lib/auth/ip'
import { signIn, signOut } from '@/lib/auth/next-auth'
import { getPasswordPolicy } from '@/lib/auth/policy'
import { requireAuth } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { isAppError } from '@/lib/errors'

import { changePasswordSchema, loginSchema } from './schema'
import { changeOwnPassword } from './service'

/**
 * Auth actions.
 *
 * `loginAction` is the one action in the codebase with no permission check, for
 * the obvious reason. Everything it can do is bounded by the throttle and by
 * `authenticate()`.
 */

export interface ActionMessage {
  /** A key into `src/i18n/ar.ts` — never Arabic prose (CLAUDE.md UI rules). */
  messageKey: string
  params?: Record<string, string | number>
}

export type LoginActionResult = { ok: true } | ({ ok: false } & ActionMessage)

/**
 * Map Auth.js's error code back to an Arabic message key.
 *
 * The codes are minted in `lib/auth/config.ts` and mean exactly what the
 * service already decided; nothing is inferred here.
 */
function messageForCode(code: string | undefined): ActionMessage {
  if (!code) return { messageKey: 'auth.invalidCredentials' }

  const [kind, detail] = code.split(':')

  if (kind === LOGIN_ERROR_CODES.throttled) {
    return {
      messageKey: 'auth.lockedForMinutes',
      params: { minutes: Number(detail ?? 1) },
    }
  }
  if (kind === LOGIN_ERROR_CODES.inactive) return { messageKey: 'auth.accountInactive' }
  return { messageKey: 'auth.invalidCredentials' }
}

export async function loginAction(raw: unknown): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, messageKey: 'auth.invalidCredentials' }
  }

  try {
    // `redirect: false` so the failure comes back as a value. With redirect on,
    // Auth.js throws NEXT_REDIRECT and the form has no way to render a message.
    await signIn('credentials', {
      username: parsed.data.username,
      password: parsed.data.password,
      redirect: false,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, ...messageForCode((error as { code?: string }).code) }
    }
    throw error
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

/**
 * Change your own password. Requires knowing the current one, which is what
 * separates it from the admin reset — and is why it needs no permission beyond
 * being signed in.
 */
export const changeOwnPasswordAction = requireAuth(
  async (actor, raw: unknown): Promise<ActionMessage | null> => {
    const input = changePasswordSchema.parse(raw)

    try {
      await changeOwnPassword(prisma, {
        userId: actor.id,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        policy: await getPasswordPolicy(),
        ip: clientIpFromHeaders(await headers()),
      })
    } catch (error) {
      // The service speaks in message keys; surface them rather than a 500, so
      // "your current password is wrong" reaches the form as a field error.
      if (isAppError(error) && error.code === 'DOMAIN') {
        return {
          messageKey: error.messageKey,
          params: (error.details ?? {}) as Record<string, string | number>,
        }
      }
      throw error
    }

    // The JWT carries `mustChangePassword`, and the middleware routes on it.
    // Without this the user would be redirected back to the change-password
    // page immediately after succeeding on it.
    await refreshSessionToken()
    revalidatePath('/', 'layout')
    return null
  },
)
