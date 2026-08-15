import { describe, expect, it, vi } from 'vitest'

import { ForbiddenError } from '@/lib/errors'
import type { Actor, Permission } from '@/lib/rbac'

import { createLedgerEntry, createUser, seedPermissionCatalog } from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { actingAs, nobody, superAdmin } from '../../helpers/auth'
import { clearSessionActor, setSessionActor } from '../../helpers/session-mock'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

// The queries import `@/lib/auth/session`, which reaches for Auth.js and a
// `Request` that does not exist in a Vitest process. The helper replaces only
// how the actor is obtained — the permission check itself is the real one.
vi.mock('@/lib/auth/session', () => import('../../helpers/session-mock'))

const { getMyLedgerPage, scopeLedger } = await import('@/modules/ledger/queries')
const { scopePayouts } = await import('@/modules/payout/queries')

const db = testDb()
const IN_AUGUST = cairo('2026-08-10T09:00')

/**
 * CLAUDE.md invariant 3: "Permissions are enforced in the query layer,
 * server-side. Hiding a button is cosmetic."
 *
 * The money screens have the sharpest version of that requirement in the
 * product — a scope that is one key too wide does not show a منفّذ a button
 * they cannot press, it shows them the whole agency's pay.
 */
describe('modules/ledger — نطاق القراءة', () => {
  it('صاحب ledger.view.all يرى الجميع', () => {
    expect(scopeLedger(actingAs(['ledger.view.all']))).toEqual({})
  })

  it('صاحب ledger.view.own يرى نفسه فقط', () => {
    const actor = actingAs(['ledger.view.own'], { id: 'u1' })
    expect(scopeLedger(actor)).toEqual({ userId: 'u1' })
  })

  it('من لا يملك أيًّا منهما لا يرى شيئًا — لا صفحة فارغة', () => {
    // Returning `{userId: actor.id}` as a "safe" fallback would silently grant
    // ledger.view.own to every authenticated user in the product.
    expect(() => scopeLedger(nobody())).toThrow(ForbiddenError)
    expect(() => scopeLedger(null)).toThrow(ForbiddenError)
  })

  it('SUPER_ADMIN يرى الجميع ضمنيًا', () => {
    expect(scopeLedger(superAdmin())).toEqual({})
  })
})

describe('modules/payout — نطاق القراءة', () => {
  it('صاحب payout.view يرى كل المستحقات', () => {
    expect(scopePayouts(actingAs(['payout.view']))).toEqual({})
  })

  it('المنفّذ يرى مستحقاته عبر ledger.view.own لا عبر payout.view', () => {
    // Making a منفّذ hold `payout.view` to read their own statement would show
    // them everybody else's at the same time.
    const actor = actingAs(['ledger.view.own'], { id: 'u9' })
    expect(scopePayouts(actor)).toEqual({ userId: 'u9' })
  })

  it('من لا يملك أيًّا منهما يُمنع', () => {
    expect(() => scopePayouts(nobody())).toThrow(ForbiddenError)
    expect(() => scopePayouts(null)).toThrow(ForbiddenError)
  })
})

/**
 * `getMyLedgerPage` is the one read that must ignore the scope it would
 * otherwise widen to. Exercised through the real query, with the session mocked
 * at the boundary `requireActor` reads from — anything less would be testing a
 * different function than the page calls.
 */
describe('modules/ledger — مستحقاتي تخصّ صاحبها وحده', () => {
  async function scenario(permissions: readonly Permission[]) {
    await seedPermissionCatalog(db)
    const me = await createUser(db)
    const other = await createUser(db)
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: me.id,
      amount: '500.00',
    })
    await createLedgerEntry(db, {
      createdAt: IN_AUGUST,
      userId: other.id,
      amount: '900.00',
    })

    const actor: Actor = {
      ...(await actorFor(db, me.id)),
      permissions: new Set(permissions),
    }
    setSessionActor(actor)
    return { me, other }
  }

  it('لا تعرض حركات غيره ولو كان يملك ledger.view.all', async () => {
    // The finance scope widens to everyone, and it must not reach this page: a
    // manager who also holds that key would open their own مستحقاتي and find
    // the whole agency's pay on it.
    const { me } = await scenario(['ledger.view.all', 'ledger.view.own'])

    const page = await getMyLedgerPage({})

    expect(page.total).toBe(1)
    expect(page.items.every((entry) => entry.userId === me.id)).toBe(true)
    expect(page.balance).toBe('500.00')
    clearSessionActor()
  })

  it('تعمل لصاحب ledger.view.own وحده', async () => {
    const { me } = await scenario(['ledger.view.own'])

    const page = await getMyLedgerPage({})
    expect(page.total).toBe(1)
    expect(page.items[0]?.userId).toBe(me.id)
    clearSessionActor()
  })

  it('تُمنع عمّن لا يملك أي مفتاح للحركات المالية', async () => {
    await scenario([])
    await expect(getMyLedgerPage({})).rejects.toBeInstanceOf(ForbiddenError)
    clearSessionActor()
  })
})
