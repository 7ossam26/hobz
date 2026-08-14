import { describe, expect, it } from 'vitest'

import { ar } from '@/i18n/ar'
import { PERMISSIONS, permissionDomain } from '@/lib/rbac'
import { createRoleSchema, updateRoleSchema } from '@/modules/role/schema'
import { permissionGroups } from '@/modules/role/service'

describe('modules/role — مخطّط الدور', () => {
  const valid = {
    nameAr: 'مدير مشروع',
    nameEn: 'PROJECT_MANAGER',
    permissions: ['project.view.all', 'task.assign'],
  }

  it('يقبل دورًا صحيحًا', () => {
    const parsed = createRoleSchema.parse(valid)
    expect(parsed.nameEn).toBe('PROJECT_MANAGER')
    expect(parsed.permissions).toEqual(['project.view.all', 'task.assign'])
  })

  it('يرفع حالة المعرّف الإنجليزي تلقائيًا', () => {
    expect(createRoleSchema.parse({ ...valid, nameEn: 'project_manager' }).nameEn).toBe(
      'PROJECT_MANAGER',
    )
  })

  it('يرفض معرّفًا إنجليزيًا بصيغة خاطئة', () => {
    for (const nameEn of ['project manager', '1MANAGER', '_MANAGER', 'مدير', 'A']) {
      expect(
        createRoleSchema.safeParse({ ...valid, nameEn }).success,
        `accepted "${nameEn}"`,
      ).toBe(false)
    }
  })

  it('يوجب اسمًا عربيًا غير فارغ', () => {
    expect(createRoleSchema.safeParse({ ...valid, nameAr: '' }).success).toBe(false)
    expect(createRoleSchema.safeParse({ ...valid, nameAr: '   ' }).success).toBe(false)
  })

  it('يرفض أي صلاحية خارج الكتالوج', () => {
    // The guard against a stale cached form granting something that no longer
    // exists — or never did.
    expect(
      createRoleSchema.safeParse({ ...valid, permissions: ['task.destroyEverything'] })
        .success,
    ).toBe(false)
    expect(createRoleSchema.safeParse({ ...valid, permissions: [''] }).success).toBe(
      false,
    )
    expect(createRoleSchema.safeParse({ ...valid, permissions: [42] }).success).toBe(
      false,
    )
  })

  it('يقبل كل مفتاح في الكتالوج', () => {
    expect(
      createRoleSchema.safeParse({ ...valid, permissions: [...PERMISSIONS] }).success,
    ).toBe(true)
  })

  it('يقبل دورًا بلا صلاحيات', () => {
    // A role with nothing ticked is legitimate — it is how an account is
    // parked without deactivating it.
    expect(createRoleSchema.parse({ ...valid, permissions: undefined }).permissions).toEqual(
      [],
    )
  })

  it('يعتبر الوصف الفارغ غيابًا', () => {
    expect(createRoleSchema.parse({ ...valid, description: '' }).description).toBeUndefined()
    expect(createRoleSchema.parse({ ...valid, description: '  وصف  ' }).description).toBe(
      'وصف',
    )
  })

  it('لا يسمح مخطّط التعديل بتغيير المعرّف الإنجليزي', () => {
    // It is what audit history and the SUPER_ADMIN check are written against.
    const parsed = updateRoleSchema.parse({ id: 'r1', ...valid, nameEn: 'RENAMED' })
    expect(parsed).not.toHaveProperty('nameEn')
  })
})

describe('modules/role — مجموعات الصلاحيات', () => {
  it('يغطّي كل مفتاح في الكتالوج مرة واحدة بالضبط', () => {
    const groups = permissionGroups()
    const keys = groups.flatMap((g) => g.permissions.map((p) => p.key))

    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([...PERMISSIONS].sort())
  })

  it('يبني المجموعات من الكتالوج لا من جدول قاعدة البيانات', () => {
    // So a permission added in a later phase appears the moment it is deployed,
    // whether or not the seed has run yet.
    const groups = permissionGroups()
    const domains = new Set(PERMISSIONS.map(permissionDomain))
    expect(groups).toHaveLength(domains.size)
  })

  it('يوفّر مسمى عربيًا لكل مجموعة ووصفًا لكل صلاحية', () => {
    for (const group of permissionGroups()) {
      expect(group.labelAr).toBeTruthy()
      expect(group.labelAr).not.toBe(group.domain)
      for (const permission of group.permissions) {
        expect(permission.descriptionAr).toBe(ar.permissions[permission.key])
      }
    }
  })
})
