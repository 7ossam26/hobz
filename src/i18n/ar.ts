/**
 * The Arabic string table — the ONLY file in the repo allowed to contain Arabic
 * literals (CLAUDE.md UI rules; enforced by the `no-restricted-syntax` rule in
 * eslint.config.mjs, which exempts this path).
 *
 * Everything imports from here: components, server actions, error mapping, the
 * permission catalog descriptions, and the seed script.
 *
 * Terminology is fixed by CLAUDE.md and must not drift:
 *   worker → منفّذ · task → مهمة · project → مشروع · penalty → خصم
 *   bonus → مكافأة · advance → سلفة · payout → مستحقات · cycle → دورة صرف
 *   extension → تمديد
 */

export const ar = {
  app: {
    name: 'نظام الوكالة',
    shortName: 'الوكالة',
    description: 'نظام تشغيل داخلي لإدارة المشاريع والمهام والمستحقات',
    tagline: 'الخصومات والمستحقات حساب، لا اجتهاد',
  },

  common: {
    save: 'حفظ',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    delete: 'حذف',
    edit: 'تعديل',
    create: 'إنشاء',
    search: 'بحث',
    filter: 'تصفية',
    clear: 'مسح',
    close: 'إغلاق',
    back: 'رجوع',
    next: 'التالي',
    previous: 'السابق',
    loading: 'جارٍ التحميل…',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    yes: 'نعم',
    no: 'لا',
    none: 'لا يوجد',
    all: 'الكل',
    reason: 'السبب',
    notes: 'ملاحظات',
    actions: 'إجراءات',
    details: 'التفاصيل',
    from: 'من',
    to: 'إلى',
    total: 'الإجمالي',
    theme: 'المظهر',
    themeLight: 'فاتح',
    themeDark: 'داكن',
    density: 'الكثافة',
    densityComfortable: 'مريح',
    densityCompact: 'مضغوط',
  },

  nav: {
    dashboard: 'لوحة التحكم',
    projects: 'المشاريع',
    tasks: 'المهام',
    clients: 'العملاء',
    users: 'المستخدمون',
    roles: 'الأدوار',
    calendar: 'التقويم',
    leave: 'الإجازات',
    ledger: 'الحركات المالية',
    myEarnings: 'مستحقاتي',
    payouts: 'المستحقات',
    penalties: 'الخصومات',
    bonuses: 'المكافآت',
    reports: 'التقارير',
    settings: 'الإعدادات',
    auditLog: 'سجل التدقيق',
    import: 'الاستيراد',
    notifications: 'الإشعارات',
  },

  auth: {
    signIn: 'تسجيل الدخول',
    signOut: 'تسجيل الخروج',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    invalidCredentials: 'اسم المستخدم أو كلمة المرور غير صحيحة',
    accountInactive: 'هذا الحساب معطّل. راجع مدير النظام.',
    tooManyAttempts: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.',
  },

  errors: {
    unauthenticated: 'يلزم تسجيل الدخول للمتابعة',
    forbidden: 'لا تملك صلاحية تنفيذ هذا الإجراء',
    notFound: 'العنصر المطلوب غير موجود',
    validation: 'البيانات المُدخلة غير صحيحة',
    conflict: 'تعارض مع الحالة الحالية للبيانات',
    domain: 'هذا الإجراء يخالف قواعد العمل',
    notImplemented: 'هذه الميزة لم تُنفَّذ بعد',
    unexpected: 'حدث خطأ غير متوقع',
    settingInvalid: 'قيمة الإعداد مخزَّنة بشكل غير صالح',
    settingUnknown: 'مفتاح إعداد غير معروف',
  },

  /** Labels for the permission-catalog groups in the role editor. */
  permissionDomains: {
    user: 'المستخدمون',
    role: 'الأدوار والصلاحيات',
    client: 'العملاء',
    project: 'المشاريع',
    task: 'المهام',
    calendar: 'التقويم',
    leave: 'الإجازات',
    ledger: 'الحركات المالية',
    penalty: 'الخصومات',
    bonus: 'المكافآت',
    advance: 'السلف',
    payout: 'المستحقات',
    report: 'التقارير',
    settings: 'الإعدادات',
    import: 'الاستيراد',
    audit: 'سجل التدقيق',
  },

  /** One Arabic description per key in the SPEC §6 catalog. Seeded to the DB. */
  permissions: {
    'user.view': 'عرض المستخدمين',
    'user.create': 'إنشاء مستخدم',
    'user.edit': 'تعديل بيانات المستخدمين',
    'user.deactivate': 'تعطيل مستخدم',
    'user.resetPassword': 'إعادة تعيين كلمة مرور مستخدم',
    'user.impersonate': 'الدخول بحساب مستخدم آخر',

    'role.view': 'عرض الأدوار',
    'role.manage': 'إنشاء وتعديل وحذف الأدوار',

    'client.view': 'عرض العملاء',
    'client.manage': 'إضافة وتعديل العملاء',

    'project.view.all': 'عرض كل المشاريع',
    'project.view.assigned': 'عرض المشاريع المسنَدة إليه فقط',
    'project.create': 'إنشاء مشروع',
    'project.edit': 'تعديل مشروع',
    'project.delete': 'حذف مشروع',

    'task.view.all': 'عرض كل المهام',
    'task.view.assigned': 'عرض المهام المسنَدة إليه فقط',
    'task.create': 'إنشاء مهمة',
    'task.edit': 'تعديل مهمة',
    'task.assign': 'إسناد المهام إلى المنفّذين',
    'task.approve': 'اعتماد تسليم المهام',
    'task.extend': 'اعتماد طلبات التمديد',
    'task.cancel': 'إلغاء مهمة',
    'task.comment': 'إضافة تعليقات على المهام',

    'calendar.manage': 'إدارة أيام العطلات والتقويم',
    'leave.view': 'عرض الإجازات',
    'leave.manage': 'اعتماد ورفض الإجازات',

    'ledger.view.all': 'عرض كل الحركات المالية',
    'ledger.view.own': 'عرض حركاته المالية فقط',

    'penalty.view': 'عرض الخصومات',
    'penalty.create': 'إضافة خصم يدوي',
    'penalty.reverse': 'عكس خصم',

    'bonus.create': 'إضافة مكافأة',
    'bonus.reverse': 'عكس مكافأة',

    'advance.create': 'تسجيل سلفة',

    'payout.view': 'عرض المستحقات',
    'payout.generate': 'إغلاق دورة الصرف وتوليد المستحقات',
    'payout.approve': 'اعتماد المستحقات',
    'payout.markPaid': 'تسجيل صرف المستحقات',

    'report.view': 'عرض التقارير',
    'report.export': 'تصدير التقارير',

    'settings.view': 'عرض الإعدادات',
    'settings.edit': 'تعديل الإعدادات',

    'import.run': 'تشغيل الاستيراد من ملفات Excel',

    'audit.view': 'عرض سجل التدقيق',
  },

  roles: {
    superAdmin: 'مدير النظام',
    superAdminDescription:
      'دور النظام الأعلى. يملك كل الصلاحيات ضمنيًا ولا يمكن تعديله أو حذفه.',
  },

  settings: {
    title: 'الإعدادات',
    groups: {
      penalty: 'الخصومات',
      calendar: 'التقويم وأيام العمل',
      payout: 'دورة الصرف',
      performance: 'مؤشر الأداء',
      health: 'صحة المشاريع',
      notifications: 'الإشعارات',
      tasks: 'المهام',
      projects: 'المشاريع',
      labels: 'المسميات العربية',
      whatsapp: 'قوالب واتساب',
    },
    keys: {
      'penalty.defaultMode': 'طريقة احتساب الخصم الافتراضية',
      'penalty.defaultValue': 'قيمة الخصم الافتراضية',
      'penalty.defaultGraceHours': 'مهلة السماح الافتراضية (بالساعات)',
      'penalty.penalizeRevisionLateness': 'احتساب تأخير التعديلات',
      'calendar.weekendDays': 'أيام العطلة الأسبوعية',
      'calendar.workdayStart': 'بداية يوم العمل',
      'calendar.workdayEnd': 'نهاية يوم العمل',
      'calendar.workingDaysPerMonth': 'أيام العمل في الشهر',
      'calendar.leaveTypes': 'أنواع الإجازات',
      'payout.cycleDay': 'يوم إغلاق دورة الصرف',
      'payout.paymentMethods': 'طرق الصرف',
      'performance.weightOnTime': 'وزن الالتزام بالمواعيد',
      'performance.weightQuality': 'وزن تقييم الجودة',
      'performance.weightVolume': 'وزن حجم الإنجاز',
      'performance.weightEstimateAccuracy': 'وزن دقة التقدير',
      'health.overdueTasksThreshold': 'حد المهام المتأخرة للحالة الحمراء',
      'health.blockedDaysThreshold': 'حد أيام التوقف للحالة الحمراء',
      'health.amberDaysBeforeDue': 'أيام التحذير قبل الموعد النهائي',
      'notifications.escalateToPmAfterDays': 'تصعيد لمدير المشروع بعد (أيام)',
      'notifications.escalateToAdminAfterDays': 'تصعيد لمدير النظام بعد (أيام)',
      'notifications.digestHourCairo': 'ساعة الملخص اليومي',
      'notifications.pollingIntervalSeconds': 'فترة تحديث البيانات (ثانية)',
      'tasks.categories': 'تصنيفات المهام',
      'projects.engagementTypes': 'أنواع التعاقد',
      'labels.taskStatus': 'مسميات حالات المهام',
      'labels.projectStatus': 'مسميات حالات المشاريع',
      'labels.priority': 'مسميات الأولويات',
      'whatsapp.templates': 'قوالب رسائل واتساب',
    },
  },

  enums: {
    payType: {
      SALARY: 'راتب شهري',
      PER_TASK: 'بالمهمة',
      HYBRID: 'مختلط',
    },
    weekday: {
      SUN: 'الأحد',
      MON: 'الاثنين',
      TUE: 'الثلاثاء',
      WED: 'الأربعاء',
      THU: 'الخميس',
      FRI: 'الجمعة',
      SAT: 'السبت',
    },
    penaltyMode: {
      FIXED_PER_DAY: 'مبلغ ثابت عن كل يوم تأخير',
      PCT_TASK_VALUE_PER_DAY: 'نسبة من قيمة المهمة عن كل يوم',
      PCT_DAILY_RATE_PER_DAY: 'نسبة من أجر اليوم عن كل يوم',
      FIXED_ONCE: 'مبلغ ثابت مرة واحدة',
      PCT_TASK_VALUE_ONCE: 'نسبة من قيمة المهمة مرة واحدة',
    },
    taskStatus: {
      BACKLOG: 'قائمة الانتظار',
      ASSIGNED: 'مسنَدة',
      IN_PROGRESS: 'قيد التنفيذ',
      SUBMITTED: 'تم التسليم',
      IN_REVIEW: 'قيد المراجعة',
      REVISION_REQUESTED: 'مطلوب تعديل',
      APPROVED: 'معتمدة',
      DONE: 'منتهية',
      BLOCKED: 'متوقفة',
      CANCELLED: 'ملغاة',
    },
    projectStatus: {
      DRAFT: 'مسودة',
      PROPOSED: 'مقترح',
      ACTIVE: 'نشط',
      ON_HOLD: 'متوقف مؤقتًا',
      IN_REVIEW: 'قيد المراجعة',
      COMPLETED: 'مكتمل',
      CANCELLED: 'ملغى',
      ARCHIVED: 'مؤرشف',
    },
    priority: {
      LOW: 'منخفضة',
      MEDIUM: 'متوسطة',
      HIGH: 'عالية',
      URGENT: 'عاجلة',
    },
    engagementType: {
      FIXED_PRICE: 'سعر ثابت',
      RETAINER: 'عقد شهري',
      MILESTONE_BASED: 'على مراحل',
      HOURLY: 'بالساعة',
    },
    ledgerType: {
      EARNING: 'استحقاق مهمة',
      SALARY: 'راتب',
      PENALTY: 'خصم',
      BONUS: 'مكافأة',
      ADVANCE: 'سلفة',
      ADJUSTMENT: 'تسوية',
      PAYOUT: 'صرف',
      REVERSAL: 'عكس قيد',
    },
  },

  /** Default seed values for Settings entries that hold Arabic content. */
  defaults: {
    leaveTypes: ['إجازة سنوية', 'إجازة مرضية', 'إجازة طارئة', 'إجازة بدون أجر'],
    taskCategories: ['تصميم', 'تطوير', 'محتوى', 'تسويق', 'مونتاج', 'إدارة'],
    paymentMethods: ['إنستاباي', 'فودافون كاش', 'تحويل بنكي', 'نقدًا'],
    whatsappTemplates: {
      taskAssigned:
        'السلام عليكم {name}، تم إسناد مهمة "{task}" إليك، موعد التسليم {due}.',
      taskOverdue: 'تذكير: مهمة "{task}" تجاوزت موعد التسليم {due}.',
      payoutPaid: 'تم صرف مستحقاتك بمبلغ {amount}.',
    },
  },

  a11y: {
    skipToContent: 'تخطَّ إلى المحتوى',
    toggleTheme: 'تبديل المظهر',
    openMenu: 'فتح القائمة',
  },
} as const

export type ArabicStrings = typeof ar

/** Convenience for the layout and metadata. */
export const LOCALE = 'ar-EG'
export const DIRECTION = 'rtl'
