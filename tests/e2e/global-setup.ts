import { execSync } from 'node:child_process'

import { PrismaClient } from '@prisma/client'

import { hashPassword } from '../../src/lib/auth/password'
import { SUPER_ADMIN_ROLE, permissionSeedRows } from '../../src/lib/rbac/catalog'
import { assertTestDatabase, promoteTestDatabaseUrl } from '../setup/db-guard'

/**
 * Playwright global setup.
 *
 * Same guard as the Vitest suite (docs/TESTING.md §2, CLAUDE.md invariant 10):
 * promote `TEST_DATABASE_URL`, then refuse outright unless the database name
 * ends in `_test`. An e2e run creates users and roles, so pointing it at a dev
 * database would be a mess and at production a catastrophe.
 */

export const E2E_ADMIN = {
  username: 'e2e.admin',
  password: 'e2e-super-admin-password',
  fullName: 'مدير النظام',
} as const

export default async function globalSetup(): Promise<void> {
  promoteTestDatabaseUrl()
  const dbName = assertTestDatabase()

  execSync('pnpm prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  })

  const prisma = new PrismaClient()

  try {
    // A clean slate, so a rerun is not affected by the last run's leftovers.
    // TRUNCATE, never DROP — the schema is the one the migrations produced.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "audit_logs", "login_throttles", "user_roles", "role_permissions", "users", "roles", "permissions", "settings" RESTART IDENTITY CASCADE',
    )

    await prisma.permission.createMany({
      data: permissionSeedRows(),
      skipDuplicates: true,
    })

    const role = await prisma.role.create({
      data: {
        nameEn: SUPER_ADMIN_ROLE,
        nameAr: 'مدير النظام',
        isSystem: true,
        // No RolePermission rows: SUPER_ADMIN holds everything implicitly
        // (SPEC §2). The flow below relies on exactly that.
      },
    })

    await prisma.user.create({
      data: {
        username: E2E_ADMIN.username,
        passwordHash: await hashPassword(E2E_ADMIN.password),
        fullName: E2E_ADMIN.fullName,
        isWorker: false,
        isActive: true,
        // The flow signs in and expects the app, not a forced password change.
        mustChangePassword: false,
        payType: 'SALARY',
        roles: { create: { roleId: role.id } },
      },
    })

    console.info(`[e2e] seeded super admin into "${dbName}"`)
  } finally {
    await prisma.$disconnect()
  }
}
