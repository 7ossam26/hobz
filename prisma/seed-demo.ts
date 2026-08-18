import { PrismaClient } from '@prisma/client'

import { fanOut } from '../src/lib/events'
import type { Actor } from '../src/lib/rbac'
import { PERMISSIONS } from '../src/lib/rbac/catalog'
import { getSetting } from '../src/lib/settings'
import { createClientSchema } from '../src/modules/client/schema'
import { createClient as createClientRecord } from '../src/modules/client/service'
import { ledgerTaskEvents } from '../src/modules/ledger/earnings'
import { recordAdvance, recordBonus } from '../src/modules/ledger/service'
import { notificationTaskEvents } from '../src/modules/notification/bus'
import { closeCycle, approvePayout, markPayoutPaid } from '../src/modules/payout/service'
import { createManualPenalty } from '../src/modules/penalty/service'
import { createProjectSchema } from '../src/modules/project/schema'
import { createProject } from '../src/modules/project/service'
import { createRoleSchema } from '../src/modules/role/schema'
import { createRole } from '../src/modules/role/service'
import type { TaskEventBus } from '../src/modules/task/ports'
import { createTaskSchema } from '../src/modules/task/schema'
import {
  approveTask,
  blockTask,
  cancelTask,
  createTask,
  requestRevision,
  reviewTask,
  startTask,
  submitTask,
} from '../src/modules/task/service'
import { createUserSchema } from '../src/modules/user/schema'
import { createUser } from '../src/modules/user/service'

/**
 * prisma/seed-demo.ts — a small, readable dataset for demos and for looking at
 * a screen that is not empty.
 *
 *   pnpm db:seed        # first: permissions, settings, the SUPER_ADMIN
 *   pnpm db:seed:demo   # then: this
 *
 * ── Two rules it follows ───────────────────────────────────────────────────
 *
 * **Everything goes through the real services.** Not one `prisma.task.create`
 * with a hand-picked `status`. A demo built by writing rows directly is a demo
 * that can show a state the product cannot reach — an APPROVED task with no
 * `approvedAt`, an EARNING with no task, a payout whose `net` does not match
 * its ledger. Driving the state machine and the ledger means every row here is
 * one a user could have produced, and it means this file is also a smoke test
 * of nine services at once.
 *
 * **It is modest on purpose.** 12 منفّذين, 5 projects, 60 tasks, one closed
 * cycle, a handful of deductions and bonuses. The point of demo data is that a
 * person can read a screen and understand it; ten thousand rows demonstrate
 * only that inserts work.
 *
 * ── Refusals ───────────────────────────────────────────────────────────────
 *
 * Refuses to run in production, and refuses to run twice (it is additive, not
 * idempotent — a second run would double every figure on every dashboard).
 * Both are overridable by an env var, deliberately noisy ones.
 */

const prisma = new PrismaClient()

/**
 * Exactly what `modules/task/actions.ts` composes for approval and
 * cancellation: the ledger first, then the notification, so a message about a
 * payment never precedes the payment.
 */
const approvalEvents: TaskEventBus = fanOut([ledgerTaskEvents, notificationTaskEvents])

const DAY_MS = 24 * 60 * 60 * 1000
const now = new Date()
const daysAgo = (days: number): Date => new Date(now.getTime() - days * DAY_MS)
const daysAhead = (days: number): Date => new Date(now.getTime() + days * DAY_MS)

/** The demo's history starts here — comfortably inside the previous cycle. */
const HISTORY_START_DAYS = 50

// ─────────────────────────────────────────────────────────────────────────────
// The people, in Egyptian Arabic, with the spelling variants the search
// normaliser exists for (أحمد / احمد, فاطمة / فاطمه).
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerSpec {
  username: string
  fullName: string
  phone: string
  payType: 'SALARY' | 'PER_TASK' | 'HYBRID'
  monthlySalary: string | null
  defaultTaskRate: string | null
  capacity: number
}

const WORKERS: WorkerSpec[] = [
  {
    username: 'ahmed.ibrahim',
    fullName: 'أحمد إبراهيم',
    phone: '01001234501',
    payType: 'SALARY',
    monthlySalary: '12000.00',
    defaultTaskRate: null,
    capacity: 40,
  },
  {
    username: 'fatma.elsayed',
    fullName: 'فاطمة السيد',
    phone: '01001234502',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '650.00',
    capacity: 35,
  },
  {
    username: 'mohamed.abdelrahman',
    fullName: 'محمد عبد الرحمن',
    phone: '01001234503',
    payType: 'HYBRID',
    monthlySalary: '7000.00',
    defaultTaskRate: '400.00',
    capacity: 40,
  },
  {
    username: 'mariam.khaled',
    fullName: 'مريم خالد',
    phone: '01001234504',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '520.00',
    capacity: 30,
  },
  {
    username: 'youssef.elshennawy',
    fullName: 'يوسف الشناوي',
    phone: '01001234505',
    payType: 'SALARY',
    monthlySalary: '9500.00',
    defaultTaskRate: null,
    capacity: 40,
  },
  {
    username: 'nourhan.mostafa',
    fullName: 'نورهان مصطفى',
    phone: '01001234506',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '480.00',
    capacity: 25,
  },
  {
    username: 'omar.abdelaziz',
    fullName: 'عمر عبد العزيز',
    phone: '01001234507',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '700.00',
    capacity: 40,
  },
  {
    username: 'sara.elghandour',
    fullName: 'سارة الغندور',
    phone: '01001234508',
    payType: 'HYBRID',
    monthlySalary: '6000.00',
    defaultTaskRate: '350.00',
    capacity: 32,
  },
  {
    username: 'karim.hegazy',
    fullName: 'كريم حجازي',
    phone: '01001234509',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '600.00',
    capacity: 40,
  },
  {
    username: 'heba.fathy',
    fullName: 'هبة الله فتحي',
    phone: '01001234510',
    payType: 'SALARY',
    monthlySalary: '8500.00',
    defaultTaskRate: null,
    capacity: 40,
  },
  {
    username: 'mostafa.zaki',
    fullName: 'مصطفى زكي',
    phone: '01001234511',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '450.00',
    capacity: 20,
  },
  {
    username: 'aya.sherif',
    fullName: 'آية شريف',
    phone: '01001234512',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '550.00',
    capacity: 30,
  },
]

const MANAGERS = [
  {
    username: 'laila.mansour',
    fullName: 'ليلى منصور',
    phone: '01001234520',
    salary: '18000.00',
  },
  {
    username: 'tarek.selim',
    fullName: 'طارق سليم',
    phone: '01001234521',
    salary: '16000.00',
  },
]

const CLIENTS = [
  {
    name: 'شركة النيل للتجارة',
    phone: '01100000001',
    notes: 'عقد سنوي — تجديد في يناير.',
  },
  { name: 'مجموعة القاهرة الطبية', phone: '01100000002', notes: '' },
  {
    name: 'مطاعم البحر الأحمر',
    phone: '01100000003',
    notes: 'التواصل عبر مدير التسويق فقط.',
  },
  { name: 'أكاديمية المستقبل', phone: '01100000004', notes: '' },
]

interface ProjectSpec {
  name: string
  clientIndex: number | null
  engagementType: 'FIXED_PRICE' | 'RETAINER' | 'MILESTONE_BASED' | 'HOURLY'
  status: 'ACTIVE' | 'IN_REVIEW' | 'COMPLETED' | 'ON_HOLD'
  startDays: number
  dueDays: number
}

const PROJECTS: ProjectSpec[] = [
  {
    name: 'الهوية البصرية — النيل',
    clientIndex: 0,
    engagementType: 'FIXED_PRICE',
    status: 'ACTIVE',
    startDays: -45,
    dueDays: 20,
  },
  {
    name: 'حملة رمضان',
    clientIndex: 2,
    engagementType: 'MILESTONE_BASED',
    status: 'ACTIVE',
    startDays: -30,
    dueDays: 12,
  },
  {
    name: 'الموقع الإلكتروني — القاهرة الطبية',
    clientIndex: 1,
    engagementType: 'FIXED_PRICE',
    status: 'IN_REVIEW',
    startDays: -40,
    dueDays: 5,
  },
  {
    name: 'إدارة السوشيال ميديا',
    clientIndex: 3,
    engagementType: 'RETAINER',
    status: 'ACTIVE',
    startDays: -35,
    dueDays: 40,
  },
  {
    name: 'فيديو تعريفي',
    clientIndex: null,
    engagementType: 'HOURLY',
    status: 'ON_HOLD',
    startDays: -25,
    dueDays: 30,
  },
]

/**
 * 60 tasks, spread across every `TaskStatus` and every project.
 *
 * `path` is the sequence of transitions the seed drives, so the row's status is
 * a *result* rather than a claim. `lateDays` moves the due date into the past
 * so the lateness engine has something real to measure.
 */
type TaskPath =
  | 'BACKLOG'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'REVISION_REQUESTED'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CANCELLED'

const TASK_TITLES: string[] = [
  'تصميم الشعار الأساسي',
  'دليل استخدام الهوية',
  'تصميم أوراق رسمية',
  'تصميم بروفايل الشركة',
  'مراجعة الألوان مع العميل',
  'كتابة السيناريو الإعلاني',
  'تصوير الإعلان',
  'مونتاج النسخة الأولى',
  'إضافة الترجمة العربية',
  'تجهيز نسخة السوشيال',
  'خريطة صفحات الموقع',
  'تصميم الصفحة الرئيسية',
  'تصميم صفحة الخدمات',
  'برمجة الواجهة الأمامية',
  'ربط نموذج التواصل',
  'اختبار التوافق مع الموبايل',
  'تحسين سرعة التحميل',
  'كتابة محتوى صفحة من نحن',
  'خطة النشر الشهرية',
  'تصميم منشورات الأسبوع الأول',
  'تصميم منشورات الأسبوع الثاني',
  'كتابة نصوص المنشورات',
  'الرد على تعليقات الصفحة',
  'تقرير أداء الحملة',
  'إعداد ملخص المؤشرات',
  'تصميم بانر العروض',
  'تجهيز قائمة الطعام الجديدة',
  'تصوير الأطباق',
  'تعديل صور القائمة',
  'تصميم كتيب المطعم',
  'مراجعة نصوص الكتيب',
  'تجهيز ملف الطباعة',
  'متابعة المطبعة',
  'تصميم واجهة التطبيق',
  'تجهيز أيقونات التطبيق',
  'اختبار تجربة المستخدم',
  'تحديث الهوية على المنصات',
  'إعداد عرض تقديمي للعميل',
  'اجتماع مراجعة ربع سنوي',
  'أرشفة ملفات المشروع',
  'تصميم غلاف الحملة',
  'إعداد جدول التصوير',
  'حجز موقع التصوير',
  'تجهيز المعدات',
  'مراجعة اللقطات',
  'اختيار الموسيقى',
  'تعديلات العميل الأولى',
  'تعديلات العميل الثانية',
  'تسليم النسخة النهائية',
  'إعداد فاتورة المشروع',
  'تصميم إعلان مطبوع',
  'ترجمة المحتوى للإنجليزية',
  'تدقيق لغوي للمحتوى',
  'تجهيز حساب إعلاني',
  'ضبط استهداف الجمهور',
  'متابعة ميزانية الإعلان',
  'تقرير نهاية الشهر',
  'تحديث ملف العميل',
  'تسليم أصول التصميم',
  'إغلاق المشروع وتوثيقه',
]

/**
 * The status mix. 60 tasks, and every status in SPEC §4 is represented —
 * including the two nobody demos (`CANCELLED`, `BLOCKED`), because an operator
 * evaluating the product needs to see what a stuck project looks like.
 */
const STATUS_MIX: Array<{ path: TaskPath; count: number }> = [
  { path: 'APPROVED', count: 18 },
  { path: 'IN_PROGRESS', count: 10 },
  { path: 'ASSIGNED', count: 8 },
  { path: 'SUBMITTED', count: 6 },
  { path: 'IN_REVIEW', count: 4 },
  { path: 'REVISION_REQUESTED', count: 4 },
  { path: 'BACKLOG', count: 5 },
  { path: 'BLOCKED', count: 3 },
  { path: 'CANCELLED', count: 2 },
]

const CATEGORY_IDS = [
  'design',
  'development',
  'content',
  'marketing',
  'video',
  'management',
]
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

/** Deterministic pseudo-randomness: the same demo every time it is seeded. */
function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length] as T
}

// ─────────────────────────────────────────────────────────────────────────────

function guardEnvironment(): void {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'yes') {
    throw new Error(
      'Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=yes if that is genuinely what you want.',
    )
  }
}

async function guardAlreadySeeded(): Promise<void> {
  const taskCount = await prisma.task.count()
  if (taskCount > 0 && process.env.ALLOW_DEMO_SEED !== 'yes') {
    throw new Error(
      `Database already has ${taskCount} task(s). This seed is additive, not idempotent — running it twice doubles every figure. Set ALLOW_DEMO_SEED=yes to override.`,
    )
  }
}

/** The SUPER_ADMIN the base seed created; every demo write is attributed to them. */
async function superAdminActor(): Promise<Actor> {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin'
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, fullName: true, username: true },
  })
  if (!user) {
    throw new Error(
      `No user "${username}". Run \`pnpm db:seed\` first — the demo seed builds on it.`,
    )
  }

  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    isSuperAdmin: true,
    permissions: new Set(PERMISSIONS),
  }
}

async function seedRoles(actor: Actor): Promise<{ managerId: string; workerId: string }> {
  const managerPermissions = PERMISSIONS.filter(
    (key) =>
      !key.startsWith('settings.') &&
      !key.startsWith('role.') &&
      key !== 'user.impersonate' &&
      key !== 'audit.view',
  )

  const workerPermissions = PERMISSIONS.filter((key) =>
    [
      'project.view.assigned',
      'task.view.assigned',
      'task.edit',
      'task.comment',
      'ledger.view.own',
      'extension.request',
      'leave.request',
    ].includes(key),
  )

  const manager = await createRole(prisma, {
    actor,
    input: createRoleSchema.parse({
      nameAr: 'مدير عمليات',
      nameEn: 'OPERATIONS_MANAGER',
      description: 'يدير المشاريع والمهام والمستحقات، دون الوصول إلى الإعدادات والأدوار.',
      permissions: managerPermissions,
    }),
  })

  const worker = await createRole(prisma, {
    actor,
    input: createRoleSchema.parse({
      nameAr: 'منفّذ',
      nameEn: 'WORKER',
      description: 'يرى مهامه ومستحقاته فقط.',
      permissions: workerPermissions,
    }),
  })

  return { managerId: manager.id, workerId: worker.id }
}

async function seedPeople(
  actor: Actor,
  roles: { managerId: string; workerId: string },
): Promise<{ managers: string[]; workers: string[] }> {
  const policy = { minLength: 10 }
  const managers: string[] = []
  const workers: string[] = []

  for (const spec of MANAGERS) {
    const created = await createUser(prisma, {
      actor,
      policy,
      input: createUserSchema.parse({
        username: spec.username,
        // Demo credentials, and they are meant to be obvious: this dataset is
        // for a laptop and a projector, never for a real agency's database.
        password: 'demo-password-2026',
        fullName: spec.fullName,
        phone: spec.phone,
        isWorker: false,
        payType: 'SALARY',
        monthlySalary: spec.salary,
        defaultTaskRate: '',
        weeklyCapacityHours: 40,
        roles: [roles.managerId],
      }),
    })
    managers.push(created.id)
  }

  for (const spec of WORKERS) {
    const created = await createUser(prisma, {
      actor,
      policy,
      input: createUserSchema.parse({
        username: spec.username,
        password: 'demo-password-2026',
        fullName: spec.fullName,
        phone: spec.phone,
        isWorker: true,
        payType: spec.payType,
        monthlySalary: spec.monthlySalary ?? '',
        defaultTaskRate: spec.defaultTaskRate ?? '',
        weeklyCapacityHours: spec.capacity,
        roles: [roles.workerId],
      }),
    })
    workers.push(created.id)
  }

  return { managers, workers }
}

async function seedClients(actor: Actor): Promise<string[]> {
  const ids: string[] = []
  for (const spec of CLIENTS) {
    const client = await createClientRecord(prisma, {
      actor,
      input: createClientSchema.parse(spec),
    })
    ids.push(client.id)
  }
  return ids
}

async function seedProjects(
  actor: Actor,
  clientIds: string[],
  managerIds: string[],
): Promise<string[]> {
  const ids: string[] = []
  // From Settings, exactly as `createProjectAction` reads it — a demo project
  // must not be creatable with an engagement type the operator disabled.
  const enabledEngagementTypes = await getSetting('projects.engagementTypes')

  for (const [index, spec] of PROJECTS.entries()) {
    const project = await createProject(prisma, {
      actor,
      enabledEngagementTypes,
      input: createProjectSchema.parse({
        name: spec.name,
        clientId: spec.clientIndex === null ? '' : clientIds[spec.clientIndex],
        ownerId: pick(managerIds, index),
        engagementType: spec.engagementType,
        status: spec.status,
        startDate: daysAhead(spec.startDays),
        dueDate: daysAhead(spec.dueDays),
      }),
    })
    ids.push(project.id)
  }
  return ids
}

interface TaskPlan {
  title: string
  path: TaskPath
  projectId: string
  assigneeId: string | null
  categoryId: string
  priority: (typeof PRIORITIES)[number]
  estimatedHours: number
  dueDate: Date
  /** When the task was created, and the anchor for its transitions. */
  createdAt: Date
}

function planTasks(projectIds: string[], workerIds: string[]): TaskPlan[] {
  const paths: TaskPath[] = []
  for (const entry of STATUS_MIX) {
    for (let i = 0; i < entry.count; i += 1) paths.push(entry.path)
  }

  return TASK_TITLES.map((title, index) => {
    const path = pick(paths, index)
    // Roughly a third of the delivered work is late, which is what makes the
    // deduction engine visible on the demo dashboard at all.
    const late = index % 3 === 0
    const createdAt = daysAgo(HISTORY_START_DAYS - (index % 40))

    return {
      title,
      path,
      projectId: pick(projectIds, index),
      assigneeId: path === 'BACKLOG' ? null : pick(workerIds, index),
      categoryId: pick(CATEGORY_IDS, index),
      priority: pick(PRIORITIES, index),
      estimatedHours: 2 + (index % 12),
      dueDate: late ? daysAgo(2 + (index % 9)) : daysAhead(1 + (index % 21)),
      createdAt,
    }
  })
}

async function seedTasks(
  actor: Actor,
  plans: TaskPlan[],
  categories: ReadonlyArray<{ id: string; label: string }>,
): Promise<{ created: number; approved: number }> {
  let approved = 0

  for (const [index, plan] of plans.entries()) {
    const created = await createTask(prisma, {
      actor,
      now: plan.createdAt,
      categories,
      input: createTaskSchema.parse({
        projectId: plan.projectId,
        title: plan.title,
        description: '',
        milestoneId: '',
        priority: plan.priority,
        categoryId: plan.categoryId,
        estimatedHours: plan.estimatedHours,
        dueDate: plan.dueDate,
        assigneeId: plan.assigneeId ?? '',
        taskValue: '',
        watcherIds: [],
      }),
    })

    const taskId = created.task.id
    const at = (offsetDays: number): Date =>
      new Date(plan.createdAt.getTime() + offsetDays * DAY_MS)

    // Every status below is *reached*, never asserted — the state machine
    // stamps the timestamps and writes the activity feed on the way.
    switch (plan.path) {
      case 'BACKLOG':
      case 'ASSIGNED':
        break

      case 'IN_PROGRESS':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        break

      case 'SUBMITTED':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        await submitTask(prisma, { actor, now: at(3), input: { taskId } })
        break

      case 'IN_REVIEW':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        await submitTask(prisma, { actor, now: at(3), input: { taskId } })
        await reviewTask(prisma, { actor, now: at(4), input: { taskId } })
        break

      case 'REVISION_REQUESTED':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        await submitTask(prisma, { actor, now: at(3), input: { taskId } })
        await reviewTask(prisma, { actor, now: at(4), input: { taskId } })
        await requestRevision(prisma, {
          actor,
          now: at(5),
          input: {
            taskId,
            reason: 'المطلوب تعديل الألوان لتطابق دليل الهوية.',
            newDueDate: daysAhead(4),
          },
        })
        break

      case 'APPROVED':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        await submitTask(prisma, { actor, now: at(3), input: { taskId } })
        await reviewTask(prisma, { actor, now: at(4), input: { taskId } })
        // The same bus `approveTaskAction` wires. Without it the tasks would
        // be APPROVED and nobody would have been paid — SPEC §5.1 makes
        // approval the *only* event that mints an EARNING, and it does so
        // through this subscriber, not inside the state machine.
        await approveTask(prisma, {
          actor,
          now: at(5),
          events: approvalEvents,
          input: { taskId, qualityRating: 3 + (index % 3) },
        })
        approved += 1
        break

      case 'BLOCKED':
        await startTask(prisma, { actor, now: at(1), input: { taskId } })
        await blockTask(prisma, {
          actor,
          now: at(2),
          input: { taskId, reason: 'في انتظار مواد من العميل.' },
        })
        break

      case 'CANCELLED':
        await cancelTask(prisma, {
          actor,
          now: at(2),
          events: approvalEvents,
          input: { taskId, reason: 'ألغى العميل هذا البند من نطاق العمل.' },
        })
        break
    }
  }

  return { created: plans.length, approved }
}

/**
 * The money story: a handful of deductions and bonuses, one advance, then one
 * cycle closed, approved and partly paid — which is the sequence SPEC §5.5
 * describes and the one a manager will want to see end to end.
 */
async function seedMoney(actor: Actor, workerIds: string[]): Promise<void> {
  const cycleDay = await getSetting('payout.cycleDay')
  const actorRef = { id: actor.id, fullName: actor.fullName }

  const penalties = [
    {
      worker: 0,
      amount: '250.00',
      reason: 'تسليم متأخر بعد انتهاء التمديد المعتمد.',
      days: 32,
    },
    {
      worker: 3,
      amount: '150.00',
      reason: 'عدم الرد على ملاحظات المراجعة لمدة يومين.',
      days: 28,
    },
    {
      worker: 6,
      amount: '400.00',
      reason: 'تسليم ملف بجودة أقل من المتفق عليه وأعيد العمل.',
      days: 24,
    },
  ]
  for (const entry of penalties) {
    await createManualPenalty(prisma, {
      actor: actorRef,
      cycleDay,
      userId: workerIds[entry.worker] as string,
      amount: entry.amount,
      reason: entry.reason,
      at: daysAgo(entry.days),
    })
  }

  const bonuses = [
    {
      worker: 1,
      amount: '500.00',
      reason: 'تسليم حملة رمضان قبل الموعد بأسبوع.',
      days: 30,
    },
    { worker: 4, amount: '300.00', reason: 'تغطية مهام زميل في إجازة.', days: 26 },
  ]
  for (const entry of bonuses) {
    await recordBonus(prisma, {
      actor: actorRef,
      cycleDay,
      userId: workerIds[entry.worker] as string,
      amount: entry.amount,
      reason: entry.reason,
      at: daysAgo(entry.days),
    })
  }

  await recordAdvance(prisma, {
    actor: actorRef,
    cycleDay,
    userId: workerIds[2] as string,
    amount: '1000.00',
    note: 'سلفة شخصية تُخصم من مستحقات الشهر.',
    at: daysAgo(27),
  })

  // ── Close the previous cycle ───────────────────────────────────────────
  const openCycle = await prisma.payoutCycle.findFirst({
    where: { status: 'OPEN' },
    orderBy: { periodStart: 'asc' },
    select: { id: true, periodEnd: true },
  })
  if (!openCycle) {
    console.warn('[seed:demo] no open cycle to close — skipping the payout story')
    return
  }

  const closed = await closeCycle(prisma, {
    actor: actorRef,
    cycleDay,
    cycleId: openCycle.id,
    // Past its own `periodEnd`, so this is a normal close, not an early one.
    now: new Date(Math.min(now.getTime(), openCycle.periodEnd.getTime() + DAY_MS)),
    allowEarly: true,
  })

  if (!closed.closed || !closed.cycleId) {
    console.warn(`[seed:demo] cycle not closed (${closed.skipped ?? 'unknown'})`)
    return
  }
  const closedCycleId = closed.cycleId

  const payouts = await prisma.payout.findMany({
    where: { cycleId: closedCycleId },
    select: { id: true, net: true },
    orderBy: { createdAt: 'asc' },
  })

  // Approve them all; pay two thirds in full and one in part, so the demo shows
  // a real outstanding balance rather than a uniformly settled month.
  const paymentMethods = await getSetting('payout.paymentMethods')

  for (const [index, payout] of payouts.entries()) {
    await approvePayout(prisma, { payoutId: payout.id, actor: actorRef })

    const net = Number(payout.net)
    if (net <= 0) continue

    const amount = index % 3 === 2 ? (net / 2).toFixed(2) : net.toFixed(2)
    await markPayoutPaid(prisma, {
      payoutId: payout.id,
      actor: actorRef,
      cycleDay,
      paymentMethods,
      amount,
      method: pick(paymentMethods, index),
      reference: `DEMO-${String(index + 1).padStart(3, '0')}`,
    })
  }

  console.info(
    `[seed:demo] cycle ${closedCycleId} closed — ${payouts.length} payout(s), ${closed.salaryEntries} salary entr(ies)`,
  )
}

async function main(): Promise<void> {
  guardEnvironment()
  await guardAlreadySeeded()

  console.info('[seed:demo] starting')
  const actor = await superAdminActor()

  const roles = await seedRoles(actor)
  console.info('[seed:demo] roles: مدير عمليات, منفّذ')

  const people = await seedPeople(actor, roles)
  console.info(
    `[seed:demo] people: ${people.managers.length} manager(s), ${people.workers.length} منفّذ`,
  )

  const clientIds = await seedClients(actor)
  const projectIds = await seedProjects(actor, clientIds, people.managers)
  console.info(
    `[seed:demo] ${clientIds.length} client(s), ${projectIds.length} project(s)`,
  )

  const categories = await getSetting('tasks.categories')
  const plans = planTasks(projectIds, people.workers)
  const tasks = await seedTasks(actor, plans, categories)
  console.info(`[seed:demo] ${tasks.created} task(s), ${tasks.approved} approved`)

  await seedMoney(actor, people.workers)

  console.info('[seed:demo] done — sign in as any demo user with "demo-password-2026"')
}

main()
  .catch((error: unknown) => {
    console.error('[seed:demo] failed', error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
