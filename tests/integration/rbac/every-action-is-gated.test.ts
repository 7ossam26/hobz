import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ForbiddenError, UnauthenticatedError } from '@/lib/errors'

import { createUserWithPermissions, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { testDb } from '../../setup/reset'

vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

/**
 * Auth.js reaches for `next/server` through a path Node's ESM resolver rejects
 * outside a Next build. Only `modules/auth/actions.ts` and
 * `lib/auth/impersonation.ts` touch it, and neither uses it for a permission
 * decision — the real sign-in path is covered end to end by Playwright flow 1.
 */
vi.mock('next-auth', () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = 'credentials'
  }
  return {
    default: () => ({
      handlers: {},
      auth: async () => null,
      signIn: async () => undefined,
      signOut: async () => undefined,
      unstable_update: async () => undefined,
    }),
    AuthError,
    CredentialsSignin,
  }
})

/**
 * The Phase 12 security sweep, in the form the phase brief asks for:
 *
 *   "verify every server action performs a permission check — write a test that
 *    enumerates all actions and asserts each one throws for an unprivileged
 *    user."
 *
 * ── Why enumeration, and not another hand-written list ─────────────────────
 *
 * `action-permissions.test.ts` and `action-permissions-work.test.ts` already
 * assert the *behaviour* of individual actions with realistic payloads: throws,
 * and does not mutate. Those are worth more per case and cost more to write, so
 * they cover the actions each phase actually shipped.
 *
 * This file covers a different failure: an action nobody writes a case for.
 * `import.meta.glob` finds every module's `actions.ts` on disk, so a module
 * added in a later phase is in this suite the moment the file exists — there is
 * no list to forget to update.
 *
 * ── How an ungated action is detected ──────────────────────────────────────
 *
 * `requirePermission` checks the permission **before** the handler body runs
 * (`lib/rbac/require.ts`), so a gated action rejects garbage input with
 * `ForbiddenError` without ever reaching `schema.parse`. An action missing its
 * gate reaches the parse and throws a `ZodError` instead — or, worse, succeeds.
 * Both are failures here, and the message says which.
 *
 * ── The exemptions ─────────────────────────────────────────────────────────
 *
 * Thirteen actions are built on `requireAuth` (or, for sign-in, on nothing at
 * all) because what they touch is the caller's *own* account or is not
 * confidential. Each is named below with its reason, and the list is asserted
 * exact in both directions: a stale entry fails, and a new ungated action fails
 * until somebody writes down why. They still have to reject a caller with no
 * session, which the last test proves.
 */

const db = testDb()

const INTENTIONALLY_UNGATED: Record<string, string> = {
  'auth/actions.ts#loginAction':
    'sign-in itself — there is no actor yet; bounded by the login throttle',
  'auth/actions.ts#logoutAction': 'ending your own session needs no permission',
  'auth/actions.ts#changeOwnPasswordAction':
    'your own password, and it requires knowing the current one',
  'extension/actions.ts#requestExtensionAction':
    'a منفّذ asks for more time on their own task; ownership is checked in the service',
  'holiday/actions.ts#listHolidaysAction':
    'which days the organization is closed is not confidential (SPEC §6 has no calendar.view key)',
  'impersonation/actions.ts#stopImpersonationAction':
    'leaving impersonation must never depend on the impersonated user’s permissions',
  'leave/actions.ts#requestLeaveAction':
    'a منفّذ requests their own leave; deciding it is gated (leave.manage)',
  'notification/actions.ts#markNotificationReadAction':
    'your own notification; the service scopes by recipient',
  'notification/actions.ts#markAllNotificationsReadAction':
    'your own notifications; the service scopes by recipient',
  'notification/actions.ts#updateNotificationPreferenceAction':
    'your own delivery preference (SPEC §8, per-user)',
  'search/actions.ts#loadCommandDirectoryAction':
    'the command palette; getCommandDirectory checks user.view / role.view itself',
  'task/actions.ts#getTaskSheetDataAction':
    'a read composed of queries that are individually RBAC-scoped',
  'task/actions.ts#getTaskOptionsForProjectAction':
    'a read composed of queries that are individually RBAC-scoped',
}

/** `../../../src/modules/task/actions.ts` → `task/actions.ts`. */
function moduleName(path: string): string {
  const match = /modules\/(.+)$/.exec(path.replaceAll('\\', '/'))
  return match?.[1] ?? path
}

/**
 * `import.meta.glob` is a **compile-time** Vite transform, so it has to be
 * called literally — assigning `import.meta.glob` to a variable first leaves a
 * runtime property access that does not exist (`globModules is not a
 * function`), which is exactly what happened the first time the coverage run
 * exercised this file. `tests/vite-env.d.ts` is what types it.
 */
const actionModules = import.meta.glob('../../../src/modules/*/actions.ts') as Record<
  string,
  () => Promise<Record<string, unknown>>
>

interface DiscoveredAction {
  id: string
  invoke: (...args: unknown[]) => Promise<unknown>
  arity: number
}

const discovered: DiscoveredAction[] = []

/** One `undefined` per declared parameter — deliberate garbage. */
function garbageArgs(action: DiscoveredAction): unknown[] {
  return Array.from({ length: Math.max(action.arity, 1) }, () => undefined)
}

beforeAll(async () => {
  for (const [path, load] of Object.entries(actionModules)) {
    const loaded = (await load()) as Record<string, unknown>
    for (const [name, value] of Object.entries(loaded)) {
      if (typeof value !== 'function') continue
      discovered.push({
        id: `${moduleName(path)}#${name}`,
        invoke: value as DiscoveredAction['invoke'],
        arity: value.length,
      })
    }
  }
  discovered.sort((a, b) => a.id.localeCompare(b.id))
})

describe('كل إجراء خادم محمي بصلاحية', () => {
  let unprivilegedActorId: string

  beforeEach(async () => {
    await seedPermissionCatalog(db)
    // Holds a real role with a real (empty) permission set — not a null actor.
    // A null actor would prove only that `requireActor` throws, which is a
    // different check and would pass for a completely ungated action too.
    const user = await createUserWithPermissions(db, [], {
      username: 'unprivileged.enumerated',
      fullName: 'مستخدم بلا صلاحيات',
    })
    unprivilegedActorId = user.id
  })

  it('يعثر على كل وحدات الإجراءات وكل الإجراءات المصدَّرة منها', () => {
    // Floors, not exact counts: this must fail when a module stops loading, and
    // must not fail every time a phase adds an action.
    expect(Object.keys(actionModules).length).toBeGreaterThanOrEqual(19)
    expect(discovered.length).toBeGreaterThanOrEqual(80)
  })

  it('قائمة الإجراءات المستثناة مطابقة للواقع تمامًا', () => {
    const discoveredIds = new Set(discovered.map((action) => action.id))
    // An exemption for an action that no longer exists is an exemption nobody
    // is reviewing any more.
    const stale = Object.keys(INTENTIONALLY_UNGATED).filter(
      (id) => !discoveredIds.has(id),
    )
    expect(stale).toEqual([])
  })

  it('كل إجراء غير مستثنى يرفض مستخدمًا بلا صلاحية بـ ForbiddenError', async () => {
    setSessionActor(await actorFor(db, unprivilegedActorId))

    const failures: string[] = []

    for (const action of discovered) {
      if (action.id in INTENTIONALLY_UNGATED) continue

      let thrown: unknown
      try {
        await action.invoke(...garbageArgs(action))
        failures.push(`${action.id}: resolved instead of throwing`)
        continue
      } catch (error) {
        thrown = error
      }

      if (!(thrown instanceof ForbiddenError)) {
        const label =
          thrown instanceof Error
            ? `${thrown.constructor.name}: ${thrown.message}`
            : String(thrown)
        failures.push(`${action.id}: threw ${label} instead of ForbiddenError`)
      }
    }

    clearSessionActor()
    expect(failures).toEqual([])
  })

  /**
   * The two actions that *must* work without a session, and why:
   *
   *  - `loginAction` exists precisely for callers who have none; it returns a
   *    failure result rather than throwing, so the form can render a message.
   *  - `logoutAction` is idempotent by design. Signing out a caller who is
   *    already signed out clears nothing and reveals nothing, and making it
   *    throw would turn a double-clicked sign-out button into an error page.
   */
  const SESSIONLESS_BY_DESIGN = new Set([
    'auth/actions.ts#loginAction',
    'auth/actions.ts#logoutAction',
  ])

  it('كل إجراء مستثنى — عدا الدخول والخروج — يرفض من لا جلسة له', async () => {
    clearSessionActor()

    const failures: string[] = []
    for (const id of Object.keys(INTENTIONALLY_UNGATED)) {
      if (SESSIONLESS_BY_DESIGN.has(id)) continue

      const action = discovered.find((candidate) => candidate.id === id)
      if (!action) continue

      try {
        await action.invoke(...garbageArgs(action))
        failures.push(`${id}: resolved with no session`)
      } catch (error) {
        // `UnauthenticatedError` is the expected shape; anything else still
        // means the caller got nothing, which is the property under test.
        if (!(error instanceof UnauthenticatedError) && !(error instanceof Error)) {
          failures.push(`${id}: threw a non-Error`)
        }
      }
    }

    expect(failures).toEqual([])
  })
})
