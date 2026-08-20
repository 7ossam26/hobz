import { describe, expect, it } from 'vitest'

import { recordAudit } from '@/lib/audit'
import { auditFilterSchema } from '@/modules/audit/schema'
import { listAuditEntries } from '@/modules/audit/service'
import { listUsersSchema } from '@/modules/user/schema'
import { listUsers } from '@/modules/user/service'

import { createRole, createUser, seedPermissionCatalog } from '../../factories/db'
import { actorFor, maybeActorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * docs/TESTING.md §4 axis 11 — soft-delete: "deleted rows invisible everywhere,
 * but history intact".
 *
 * The second half is the one that is easy to get wrong. A soft-deleted user
 * must vanish from every list and every lookup, and must simultaneously still
 * resolve as the named actor on the audit rows they wrote — otherwise deleting
 * someone quietly anonymises everything they ever did, which is the opposite of
 * what an append-only log is for.
 */

describe('الحذف الناعم — الصفوف تختفي والتاريخ يبقى', () => {
  it('يستثني المرشّح بدور محذوف حامليه', async () => {
    // Filtering by a soft-deleted role's id used to return its former holders.
    // A deleted role grants nothing (`resolveActor` skips it), so reporting the
    // membership would be describing access that does not exist. Invariant 8
    // applies to the filter, not only to the rows it returns.
    await seedPermissionCatalog(db)
    const dead = await createRole(db, {
      nameEn: 'DEAD_FILTER',
      permissions: ['user.view'],
      deletedAt: new Date('2026-01-01'),
    })
    const live = await createRole(db, { nameEn: 'LIVE_FILTER' })
    await createUser(db, { roleIds: [dead.id, live.id], username: 'holder' })

    const byDeadRole = await listUsers(db, listUsersSchema.parse({ roleId: dead.id }))
    expect(byDeadRole.total).toBe(0)
    expect(byDeadRole.items).toEqual([])

    // …while the live role still finds them.
    const byLiveRole = await listUsers(db, listUsersSchema.parse({ roleId: live.id }))
    expect(byLiveRole.total).toBe(1)
    expect(byLiveRole.items[0]?.username).toBe('holder')
  })

  it('لا يعرض الدور المحذوف ضمن أدوار المستخدم في القائمة', async () => {
    await seedPermissionCatalog(db)
    const dead = await createRole(db, {
      nameEn: 'DEAD_ROLE',
      deletedAt: new Date('2026-01-01'),
    })
    const live = await createRole(db, { nameEn: 'LIVE_ROLE' })
    await createUser(db, { roleIds: [dead.id, live.id] })

    const page = await listUsers(db, listUsersSchema.parse({}))
    expect(page.items[0]?.roles.map((r) => r.nameEn)).toEqual(['live_role'])
  })

  it('لا يمنح الدور المحذوف أي صلاحية لحامله', async () => {
    await seedPermissionCatalog(db)
    const dead = await createRole(db, {
      nameEn: 'DEAD_GRANT',
      permissions: ['payout.approve', 'user.create'],
      deletedAt: new Date('2026-01-01'),
    })
    const user = await createUser(db, { roleIds: [dead.id] })

    const actor = await actorFor(db, user.id)
    expect(actor.permissions.size).toBe(0)
  })

  it('يستثني المحذوفين من الإجمالي وترقيم الصفحات', async () => {
    await seedPermissionCatalog(db)
    await createUser(db, { username: 'alive.one' })
    await createUser(db, { username: 'alive.two' })
    await createUser(db, { username: 'gone.one', deletedAt: new Date('2026-01-01') })
    await createUser(db, { username: 'gone.two', deletedAt: new Date('2026-01-01') })

    const page = await listUsers(db, listUsersSchema.parse({ pageSize: 10 }))
    expect(page.total).toBe(2)
    expect(page.items.map((u) => u.username).sort()).toEqual(['alive.one', 'alive.two'])
  })

  it('يستثني المحذوفين من البحث بالاسم', async () => {
    await seedPermissionCatalog(db)
    await createUser(db, { username: 'searchable', fullName: 'أحمد إبراهيم' })
    await createUser(db, {
      username: 'gone',
      fullName: 'أحمد إبراهيم',
      deletedAt: new Date('2026-01-01'),
    })

    const page = await listUsers(db, listUsersSchema.parse({ search: 'أحمد' }))
    expect(page.total).toBe(1)
    expect(page.items[0]?.username).toBe('searchable')
  })

  it('يمنع المحذوف من تكوين جلسة', async () => {
    const gone = await createUser(db, { deletedAt: new Date('2026-01-01') })
    expect(await maybeActorFor(db, gone.id)).toBeNull()
  })

  it('يُبقي اسم المستخدم المحذوف محجوزًا', async () => {
    // Deliberate, and the opposite of how a deleted *role* behaves. A username
    // is a person's identity in the audit log; handing it to someone else would
    // rewrite history by proxy. A deleted role's `nameEn` is revived instead,
    // because a role is a label and nothing is attributed to it.
    const gone = await createUser(db, {
      username: 'taken.forever',
      deletedAt: new Date('2026-01-01'),
    })

    const stillThere = await db.user.findUnique({
      where: { username: 'taken.forever' },
      select: { id: true },
    })
    expect(stillThere?.id).toBe(gone.id)
  })

  it('يحتفظ بسجلات التدقيق ويظل يسمّي المنفِّذ بعد حذفه', async () => {
    // The half that matters: deleting someone must not anonymise everything
    // they ever did.
    await seedPermissionCatalog(db)
    const user = await createUser(db, { username: 'departed', fullName: 'المغادر' })

    await recordAudit(db, {
      actor: { id: user.id },
      action: 'user.updated',
      entity: 'User',
      entityId: 'someone-else',
      after: { fullName: 'تغيير' },
    })

    await db.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date('2026-02-01') },
    })

    const page = await listAuditEntries(db, auditFilterSchema.parse({}))
    expect(page.total).toBe(1)
    expect(page.items[0]?.actor?.fullName).toBe('المغادر')
    expect(page.items[0]?.actor?.username).toBe('departed')
    expect(page.items[0]?.after).toEqual({ fullName: 'تغيير' })
  })

  it('لا يحمل جدول التدقيق عمود حذف أصلًا', async () => {
    // The append-only invariant is stated by the column's absence
    // (CLAUDE.md invariant 7). If someone adds `deletedAt` here, this fails.
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
    `
    const names = columns.map((c) => c.column_name)

    expect(names).not.toContain('deletedAt')
    expect(names).not.toContain('updatedAt')
    expect(names).toContain('impersonatorId')
  })
})
