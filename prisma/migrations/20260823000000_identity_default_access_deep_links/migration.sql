-- Identity casing, ordinary role identifiers, and the safe new-user baseline.

ALTER TABLE "users" ADD COLUMN "usernameCanonical" TEXT;
UPDATE "users" SET "usernameCanonical" = lower(btrim("username"));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "users" GROUP BY "usernameCanonical" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize usernames: two existing accounts differ only by case or surrounding whitespace';
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "usernameCanonical" SET NOT NULL;
CREATE UNIQUE INDEX "users_usernameCanonical_key" ON "users"("usernameCanonical");

ALTER TABLE "roles" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "roles"
    WHERE "nameEn" <> 'SUPER_ADMIN'
    GROUP BY lower("nameEn")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize role identifiers: two ordinary roles differ only by case';
  END IF;
END $$;

UPDATE "roles"
SET "nameEn" = lower("nameEn"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "nameEn" <> 'SUPER_ADMIN';

INSERT INTO "permissions" ("key", "domain", "descriptionAr")
VALUES
  ('project.view.assigned', 'project', 'عرض المشاريع المسنَدة إليه فقط'),
  ('task.view.assigned', 'task', 'عرض المهام المسنَدة إليه فقط'),
  ('task.work.assigned', 'task', 'بدء وتسليم وإيقاف مهامه المسنَدة إليه'),
  ('task.comment', 'task', 'إضافة تعليقات على المهام'),
  ('ledger.view.own', 'ledger', 'عرض حركاته المالية فقط')
ON CONFLICT ("key") DO UPDATE
SET "domain" = EXCLUDED."domain", "descriptionAr" = EXCLUDED."descriptionAr";

INSERT INTO "roles" (
  "id", "nameEn", "nameAr", "description", "isSystem", "isDefault", "createdAt", "updatedAt"
)
VALUES (
  'default_employee_role',
  'employee',
  'موظف',
  'صلاحيات آمنة للحسابات الجديدة، وتقتصر على عمل المستخدم وبياناته.',
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("nameEn") DO UPDATE
SET
  "nameAr" = EXCLUDED."nameAr",
  "description" = EXCLUDED."description",
  "isSystem" = false,
  "isDefault" = true,
  "deletedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "role_permissions"
WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "nameEn" = 'employee');

INSERT INTO "role_permissions" ("roleId", "permissionKey")
SELECT role_row."id", permission_key
FROM (SELECT "id" FROM "roles" WHERE "nameEn" = 'employee') AS role_row
CROSS JOIN (
  VALUES
    ('project.view.assigned'),
    ('task.view.assigned'),
    ('task.work.assigned'),
    ('task.comment'),
    ('ledger.view.own')
) AS safe_permissions(permission_key);

CREATE UNIQUE INDEX "roles_one_live_default_idx"
ON "roles" ("isDefault")
WHERE "isDefault" = true AND "deletedAt" IS NULL;
