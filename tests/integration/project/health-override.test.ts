import { describe, expect, it } from 'vitest'

import { setProjectHealthOverride } from '@/modules/project/service'

import {
  createProject,
  createSuperAdmin,
  createUserWithPermissions,
  seedPermissionCatalog,
} from '../../factories/db'
import { actorFor } from '../../helpers/actor-from-db'
import { testDb } from '../../setup/reset'

const db = testDb()

/**
 * SPEC §5.7: "Manual override with mandatory reason" — and the phase brief
 * calls this out by name: "audit assertions on health override."
 *
 * Both directions are audited: setting an override, and clearing one back to
 * automatic. `setProjectHealthOverrideSchema` already makes the reason
 * mandatory at the boundary; these tests prove the service writes the row
 * (`healthOverride`/`healthReason`) and the audit entry together, with the
 * reason travelling on the audit row's own `reason` column as well as in
 * `after`, so a reviewer filtering the audit log by reason finds it without
 * opening the diff.
 */
describe('modules/project — التقدير اليدوي لصحة المشروع مُسجَّل بالكامل', () => {
  it('يكتب القيمة الجديدة ويسجّل تدقيقًا يحمل السبب عند ضبط تقدير يدوي', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.edit'])
    const project = await createProject(db, { ownerId: manager.id, code: 'PRJ-HLT-1' })
    const actor = await actorFor(db, manager.id)

    await setProjectHealthOverride(db, {
      actor,
      input: {
        id: project.id,
        health: 'RED',
        reason: 'تأخر تسليم العميل للمواد الأساسية',
      },
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(row.healthOverride).toBe('RED')
    expect(row.healthReason).toBe('تأخر تسليم العميل للمواد الأساسية')

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.healthOverrideSet', entityId: project.id },
    })
    expect(audit.actorId).toBe(manager.id)
    expect(audit.reason).toBe('تأخر تسليم العميل للمواد الأساسية')
    expect(audit.before).toEqual({ healthOverride: null, healthReason: null })
    expect(audit.after).toEqual({
      healthOverride: 'RED',
      healthReason: 'تأخر تسليم العميل للمواد الأساسية',
    })
  })

  it('يسجّل تدقيقًا منفصلًا عند إلغاء التقدير اليدوي والعودة للاحتساب التلقائي', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.edit'])
    const project = await createProject(db, {
      ownerId: manager.id,
      code: 'PRJ-HLT-2',
      healthOverride: 'AMBER',
      healthReason: 'سبب أولي',
    })
    const actor = await actorFor(db, manager.id)

    await setProjectHealthOverride(db, {
      actor,
      input: {
        id: project.id,
        health: null,
        reason: 'انتهى الموقف الذي استدعى التقدير اليدوي',
      },
    })

    const row = await db.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(row.healthOverride).toBeNull()
    // The reason for *clearing* is preserved even though the override itself
    // is gone — it is not stored back on `healthReason` (there is no override
    // left to explain), but the audit row keeps the record.
    expect(row.healthReason).toBeNull()

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.healthOverrideCleared', entityId: project.id },
    })
    expect(audit.reason).toBe('انتهى الموقف الذي استدعى التقدير اليدوي')
    expect(audit.before).toEqual({ healthOverride: 'AMBER', healthReason: 'سبب أولي' })
    // The row's `healthReason` clears to null with the override; the reason
    // given *for clearing* survives on the audit entry's own `reason` column
    // (asserted above), not inside `after`.
    expect(audit.after).toEqual({ healthOverride: null, healthReason: null })
  })

  it('يكتب سجلًا مستقلًا عند كل تغيير متتالٍ — لا يعيد كتابة الصف السابق', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.edit'])
    const project = await createProject(db, { ownerId: manager.id, code: 'PRJ-HLT-3' })
    const actor = await actorFor(db, manager.id)

    await setProjectHealthOverride(db, {
      actor,
      input: { id: project.id, health: 'AMBER', reason: 'سبب أول' },
    })
    await setProjectHealthOverride(db, {
      actor,
      input: { id: project.id, health: 'RED', reason: 'سبب ثانٍ' },
    })
    await setProjectHealthOverride(db, {
      actor,
      input: { id: project.id, health: null, reason: 'سبب ثالث' },
    })

    // `createProject` here is the raw DB factory (`tests/factories/db.ts`),
    // not `modules/project/service.createProject` — it writes the row
    // directly and no `project.created` audit entry, which is exactly what
    // isolates this assertion to the override actions alone.
    const rows = await db.auditLog.findMany({
      where: { entityId: project.id, entity: 'Project' },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.map((r) => r.action)).toEqual([
      'project.healthOverrideSet',
      'project.healthOverrideSet',
      'project.healthOverrideCleared',
    ])
    expect(rows.map((r) => r.reason)).toEqual(['سبب أول', 'سبب ثانٍ', 'سبب ثالث'])
  })

  it('يسجّل هوية المنفِّذ الحقيقي حتى أثناء العرض كمستخدم آخر', async () => {
    await seedPermissionCatalog(db)
    const manager = await createUserWithPermissions(db, ['project.edit'])
    const project = await createProject(db, { ownerId: manager.id, code: 'PRJ-HLT-4' })
    // `AuditLog.impersonatorId` carries a real foreign key (SPEC Phase 1 §5) —
    // the id has to resolve to an actual row, so this is a real super admin,
    // not a placeholder string.
    const admin = await createSuperAdmin(db, { username: 'health.override.admin' })

    const real = await actorFor(db, manager.id)
    const impersonated = { ...real, impersonatorId: admin.id }

    await setProjectHealthOverride(db, {
      actor: impersonated,
      input: { id: project.id, health: 'RED', reason: 'سبب' },
    })

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project.healthOverrideSet', entityId: project.id },
    })
    expect(audit.actorId).toBe(manager.id)
    expect(audit.impersonatorId).toBe(admin.id)
  })
})
