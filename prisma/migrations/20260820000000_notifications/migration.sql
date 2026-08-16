-- Phase 9 — Notifications (SPEC §8).
--
-- One enum and two tables. `notifications` is the delivered inbox;
-- `notification_preferences` holds only the per-user *overrides* — a missing
-- row means "enabled", the same missing-means-default reasoning `settings`
-- uses for the agency-wide catalog, so a brand-new user needs no seed rows at
-- all to have every non-mandatory type on.
--
-- `notifications_userId_type_dedupeKey_key` is what makes a scheduled or
-- threshold-crossing delivery (a due-soon reminder, the daily manager digest)
-- safe to attempt twice: Postgres treats every NULL in a unique index as
-- distinct from every other NULL, so the one-shot events that pass no
-- `dedupeKey` never collide with each other and rely on their own domain
-- event firing once, while the two that do pass one — TASK_DUE_SOON keyed on
-- `${taskId}:${dueDate}`, MANAGER_DIGEST keyed on the Cairo date — quietly
-- no-op on a redeploy or a job replay instead of paging someone twice.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_SUBMITTED', 'TASK_REVISION_REQUESTED', 'TASK_APPROVED', 'TASK_ESCALATED', 'TASK_MENTIONED', 'PENALTY_APPLIED', 'BONUS_GRANTED', 'MONEY_REVERSED', 'PAYOUT_APPROVED', 'PAYOUT_PAID', 'EXTENSION_REQUESTED', 'EXTENSION_DECIDED', 'MANAGER_DIGEST');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB,
    "dismissable" BOOLEAN NOT NULL DEFAULT true,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_type_dedupeKey_key" ON "notifications"("userId", "type", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
