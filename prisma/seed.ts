import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

import { ar } from '../src/i18n/ar'
import { canonicalizeUsername, normalizeUsernameDisplay } from '../src/lib/auth/username'
import {
  DEFAULT_ROLE_PERMISSIONS,
  SUPER_ADMIN_ROLE,
  permissionSeedRows,
} from '../src/lib/rbac/catalog'
import { settingSeedRows } from '../src/lib/settings/catalog'

/**
 * Seed — idempotent by construction. Running it against an existing database
 * refreshes the permission catalog and adds any new settings without touching
 * values an operator has changed.
 *
 * Deliberate behaviours, per the Phase 0 brief:
 *  - The SUPER_ADMIN comes from env vars, not from a hardcoded password.
 *  - `mustChangePassword` stays FALSE. The operator chose the password; forcing
 *    a change on first login would be theatre.
 *  - Existing Setting rows are never overwritten. The seed fills gaps only, so
 *    re-running it after go-live cannot silently reset a grace period.
 */

const prisma = new PrismaClient()

/** bcrypt cost 12, per SPEC §3. */
const BCRYPT_COST = 12

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD before seeding.`,
    )
  }
  return value
}

/**
 * Read and validate the admin credentials. Called first, before any write:
 * failing halfway through would leave a permission catalog and a SUPER_ADMIN
 * role with no user attached to it.
 */
function adminCredentials(): { username: string; password: string } {
  return {
    username: normalizeUsernameDisplay(requireEnv('SEED_ADMIN_USERNAME')),
    password: requireEnv('SEED_ADMIN_PASSWORD'),
  }
}

async function seedPermissions(): Promise<number> {
  const rows = permissionSeedRows()

  for (const row of rows) {
    await prisma.permission.upsert({
      where: { key: row.key },
      create: row,
      update: { domain: row.domain, descriptionAr: row.descriptionAr },
    })
  }

  // Permissions removed from the code catalog must not linger in the DB, or a
  // role could keep granting something the app no longer understands.
  const { count } = await prisma.permission.deleteMany({
    where: { key: { notIn: rows.map((r) => r.key) } },
  })
  if (count > 0) console.info(`[seed] removed ${count} stale permission(s)`)

  return rows.length
}

async function seedSuperAdminRole(): Promise<string> {
  const role = await prisma.role.upsert({
    where: { nameEn: SUPER_ADMIN_ROLE },
    create: {
      nameEn: SUPER_ADMIN_ROLE,
      nameAr: ar.roles.superAdmin,
      description: ar.roles.superAdminDescription,
      isSystem: true,
    },
    update: {
      nameAr: ar.roles.superAdmin,
      description: ar.roles.superAdminDescription,
      isSystem: true,
      deletedAt: null,
    },
  })

  // Intentionally NO RolePermission rows. SUPER_ADMIN holds every permission
  // implicitly (SPEC §2) — including ones added in later phases. Materialising
  // the list here would go stale the moment a permission is added.
  return role.id
}

async function seedDefaultEmployeeRole(): Promise<void> {
  const configured = await prisma.role.findFirst({
    where: { isDefault: true, deletedAt: null },
    select: { id: true },
  })
  if (configured) return

  const nameEn = 'employee'
  const existing = await prisma.role.findUnique({ where: { nameEn } })
  const role = existing
    ? await prisma.role.update({
        where: { id: existing.id },
        data: {
          nameAr: 'موظف',
          description: 'صلاحيات آمنة للحسابات الجديدة، وتقتصر على عمل المستخدم وبياناته.',
          isSystem: false,
          isDefault: true,
          deletedAt: null,
          permissions: {
            deleteMany: {},
            create: DEFAULT_ROLE_PERMISSIONS.map((permissionKey) => ({ permissionKey })),
          },
        },
      })
    : await prisma.role.create({
        data: {
          nameEn,
          nameAr: 'موظف',
          description: 'صلاحيات آمنة للحسابات الجديدة، وتقتصر على عمل المستخدم وبياناته.',
          isDefault: true,
          permissions: {
            create: DEFAULT_ROLE_PERMISSIONS.map((permissionKey) => ({ permissionKey })),
          },
        },
      })

  console.info(`[seed] default employee role: ${role.id}`)
}

async function seedSuperAdminUser(roleId: string): Promise<void> {
  const { username, password } = adminCredentials()
  const usernameCanonical = canonicalizeUsername(username)
  const fullName = process.env.SEED_ADMIN_FULL_NAME ?? username

  const existing = await prisma.user.findUnique({ where: { usernameCanonical } })

  if (existing) {
    // Do not reset the password of an account already in use.
    await prisma.user.update({
      where: { usernameCanonical },
      data: { isActive: true, deletedAt: null },
    })
    console.info(`[seed] super admin "${username}" already exists — left untouched`)
  } else {
    await prisma.user.create({
      data: {
        username,
        usernameCanonical,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        fullName,
        isWorker: false,
        isActive: true,
        // The operator picked this password deliberately — do not force a change.
        mustChangePassword: false,
        timezone: 'Africa/Cairo',
        payType: 'SALARY',
      },
    })
    console.info(`[seed] created super admin "${username}"`)
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { usernameCanonical } })
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    create: { userId: user.id, roleId },
    update: {},
  })
}

async function seedSettings(): Promise<{ created: number; kept: number }> {
  const rows = settingSeedRows()
  let created = 0
  let kept = 0

  for (const row of rows) {
    const existing = await prisma.setting.findUnique({ where: { key: row.key } })
    if (existing) {
      kept += 1
      continue
    }
    await prisma.setting.create({
      data: { key: row.key, group: row.group, value: row.value as never },
    })
    created += 1
  }

  return { created, kept }
}

async function main(): Promise<void> {
  console.info('[seed] starting')

  // Fail before touching the database, not after.
  adminCredentials()

  const permissionCount = await seedPermissions()
  console.info(`[seed] permission catalog: ${permissionCount} key(s)`)

  const roleId = await seedSuperAdminRole()
  await seedDefaultEmployeeRole()
  await seedSuperAdminUser(roleId)

  const settings = await seedSettings()
  console.info(
    `[seed] settings: ${settings.created} created, ${settings.kept} left as configured`,
  )

  console.info('[seed] done')
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
