-- Phase 6 — Calendar, Leave & Lateness Engine (SPEC §4 "Calendar", §5.2, §5.3).
--
-- Three new tables (Holiday, Leave, ExtensionRequest) and three new columns on
-- `tasks` that the nightly job writes. `WorkCalendar` from the SPEC §4 listing
-- is deliberately NOT a table — it is the `calendar.*` Settings group, per
-- CLAUDE.md invariant 4. See the comment block in prisma/schema.prisma.
--
-- `holidays.date` and `leaves.startDate`/`endDate` are DATE, not TIMESTAMP:
-- they are Cairo calendar dates, not instants. `lib/calendar` owns the one
-- conversion between a date key and a UTC instant.

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('NONE', 'PM', 'ADMIN');

-- AlterTable
ALTER TABLE "tasks"
    ADD COLUMN "overdueWorkingDays" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "escalationLevel" "EscalationLevel" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "typeId" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extension_requests" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "oldDueDate" TIMESTAMP(3) NOT NULL,
    "newDueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExtensionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holidays_isRecurring_idx" ON "holidays"("isRecurring");

-- CreateIndex
CREATE INDEX "leaves_userId_status_startDate_endDate_idx" ON "leaves"("userId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "leaves_status_startDate_idx" ON "leaves"("status", "startDate");

-- CreateIndex
CREATE INDEX "leaves_requestedById_idx" ON "leaves"("requestedById");

-- CreateIndex
CREATE INDEX "extension_requests_taskId_status_idx" ON "extension_requests"("taskId", "status");

-- CreateIndex
CREATE INDEX "extension_requests_status_createdAt_idx" ON "extension_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "extension_requests_requestedById_idx" ON "extension_requests"("requestedById");

-- CreateIndex
CREATE INDEX "tasks_projectId_escalationLevel_idx" ON "tasks"("projectId", "escalationLevel");

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_requests" ADD CONSTRAINT "extension_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_requests" ADD CONSTRAINT "extension_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extension_requests" ADD CONSTRAINT "extension_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: `calendar.leaveTypes` becomes a taxonomy, not a label list.
--
-- Same change, same reason, and the same mechanics as
-- 20260816000001_task_categories_taxonomy did for `tasks.categories`:
-- `leaves.typeId` now points at a stable id, so the setting changed from
--     ["إجازة سنوية", …]
-- to
--     [{"id": "annual", "label": "إجازة سنوية"}, …]
--
-- The seed never overwrites an existing `Setting` row, and `lib/settings`
-- Zod-validates on read — so without this an already-seeded database would
-- throw the moment anyone opened the leave form.
--
-- Labels matching a seeded default keep the meaningful id; anything an
-- operator added gets a positional `leave-type-N`. `ROW_NUMBER()` keeps the
-- ids unique even if two entries shared a label, which the old shape allowed
-- and the new one rejects. No `leaves` rows can exist yet — the table is
-- created by this same migration — so nothing needs re-pointing.

UPDATE "settings" AS s
SET "value" = rebuilt.value
FROM (
    SELECT
        jsonb_agg(
            jsonb_build_object('id', mapped.id, 'label', mapped.label)
            ORDER BY mapped.ord
        ) AS value
    FROM (
        SELECT
            elem.ord,
            elem.value AS label,
            CASE
                WHEN known.id IS NOT NULL
                     AND ROW_NUMBER() OVER (
                         PARTITION BY elem.value ORDER BY elem.ord
                     ) = 1
                THEN known.id
                ELSE 'leave-type-' || elem.ord::text
            END AS id
        FROM "settings" AS src
        CROSS JOIN LATERAL jsonb_array_elements_text(src."value")
            WITH ORDINALITY AS elem(value, ord)
        LEFT JOIN (
            VALUES
                ('إجازة سنوية', 'annual'),
                ('إجازة مرضية', 'sick'),
                ('إجازة طارئة', 'emergency'),
                ('إجازة بدون أجر', 'unpaid')
        ) AS known(label, id) ON known.label = elem.value
        WHERE src."key" = 'calendar.leaveTypes'
    ) AS mapped
) AS rebuilt
WHERE s."key" = 'calendar.leaveTypes'
  AND jsonb_typeof(s."value") = 'array'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(s."value") AS e
      WHERE jsonb_typeof(e) = 'string'
  );
