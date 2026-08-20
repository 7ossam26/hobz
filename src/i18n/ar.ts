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
    name: 'Viral lap',
    shortName: 'Viral lap',
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
    loading: 'جاري التحميل…',
    saving: 'جاري الحفظ…',
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
    apply: 'تطبيق',
    reset: 'إعادة تعيين',
    view: 'عرض',
    required: 'مطلوب',
    optional: 'اختياري',
    active: 'نشط',
    inactive: 'معطّل',
    never: 'لم يحدث',
    noResults: 'لا توجد نتائج مطابقة',
    selectAll: 'تحديد الكل',
    clearSelection: 'إلغاء التحديد',
    page: 'صفحة',
    results: 'نتيجة',
    createdAt: 'تاريخ الإنشاء',
    updatedAt: 'آخر تحديث',
    /** U+060C, the Arabic comma. Joining with a Latin ',' looks wrong in RTL. */
    listSeparator: '، ',
    retry: 'إعادة المحاولة',
    refresh: 'تحديث',
    add: 'إضافة',
    remove: 'إزالة',
    expand: 'توسيع',
    collapse: 'طيّ',
    copy: 'نسخ',
    copied: 'تم النسخ',
    unknown: 'غير معروف',
    more: 'المزيد',
    open: 'فتح',
    select: 'اختيار',
    dismiss: 'إخفاء',
    undo: 'تراجع',
    /** `{count}` is substituted at render time. */
    andMore: 'و{count} غير ذلك',
  },

  /**
   * Gregorian month names in Egyptian usage (SPEC §2: Gregorian calendar,
   * Arabic months, Western numerals). Index 0 is January.
   *
   * Hardcoded rather than taken from `Intl`: month names are display copy and
   * belong with the rest of it, and a fixed table renders identically on every
   * Node build instead of depending on the bundled ICU version.
   */
  months: [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ],

  /**
   * Gregorian weekday names, Egyptian usage — the week starts Sunday (SPEC §2:
   * Gregorian calendar). Index 0 is Sunday, matching `Date.getUTCDay()`
   * exactly, which is what the Phase 5 calendar view's grid math indexes by.
   */
  weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  weekdaysShort: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],

  /**
   * Relative time. Arabic counts inflect in four bands — singular, dual,
   * plural-of-paucity (3–10), and singular-again (11+) — so each unit carries
   * four forms. `lib/datetime` picks between them; getting this wrong is the
   * fastest way to make a product read as machine-translated.
   */
  time: {
    now: 'الآن',
    ago: 'منذ {value}',
    within: 'خلال {value}',
    and: 'و',
    units: {
      minute: { one: 'دقيقة', two: 'دقيقتين', few: '{n} دقائق', many: '{n} دقيقة' },
      hour: { one: 'ساعة', two: 'ساعتين', few: '{n} ساعات', many: '{n} ساعة' },
      day: { one: 'يوم', two: 'يومين', few: '{n} أيام', many: '{n} يوما' },
      week: { one: 'أسبوع', two: 'أسبوعين', few: '{n} أسابيع', many: '{n} أسبوعا' },
      month: { one: 'شهر', two: 'شهرين', few: '{n} أشهر', many: '{n} شهرا' },
      year: { one: 'سنة', two: 'سنتين', few: '{n} سنوات', many: '{n} سنة' },
    },
  },

  /**
   * Bare unit suffixes for a number input — `24` `ساعة`.
   *
   * Deliberately *not* `time.units` above: those inflect for count because they
   * appear inside a sentence ("منذ ساعتين"). A suffix pinned beside an editable
   * box would have to re-inflect on every keystroke, which reads worse than the
   * uninflected noun and is what every form in this product already does.
   */
  /** Installable-app chrome (Phase 12). No offline data sync — see `public/sw.js`. */
  pwa: {
    installTitle: 'ثبِّت التطبيق',
    installHint: 'افتحه من الشاشة الرئيسية مباشرة، بنافذة مستقلة.',
    install: 'تثبيت',
    later: 'لاحقا',
    offlineTitle: 'لا يوجد اتصال',
    offlineHint:
      'هذا النظام يقرأ بياناته من الخادم لحظيا، فلا تتوفّر الشاشات دون اتصال. أعد المحاولة بعد عودة الشبكة.',
  },

  units: {
    minute: 'دقيقة',
    hour: 'ساعة',
    day: 'يوم',
    second: 'ثانية',
    task: 'مهمة',
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
    signingIn: 'جاري تسجيل الدخول…',
    welcome: 'أهلا بك',
    signInHint: 'ادخل باسم المستخدم وكلمة المرور اللذين زوّدك بهما مدير النظام.',
    /** No self-signup and no self-service reset (SPEC §2). Say so plainly. */
    noSelfSignup: 'لا يوجد تسجيل ذاتي. الحسابات يُنشئها مدير النظام فقط.',
    forgotPassword: 'نسيت كلمة المرور؟ تواصل مع مدير النظام لإعادة تعيينها.',
    /** `{minutes}` is substituted at render time. */
    lockedForMinutes: 'الحساب موقوف مؤقتا. حاول بعد {minutes} دقيقة.',
    changePassword: 'تغيير كلمة المرور',
    currentPassword: 'كلمة المرور الحالية',
    newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور الجديدة',
    passwordMismatch: 'كلمتا المرور غير متطابقتين',
    passwordChanged: 'تم تغيير كلمة المرور',
    passwordSameAsOld: 'كلمة المرور الجديدة مطابقة للحالية',
    mustChangePassword: 'يجب تغيير كلمة المرور قبل المتابعة',
    mustChangePasswordHint:
      'أعاد مدير النظام تعيين كلمة مرورك. اختر كلمة مرور جديدة للمتابعة.',
    sessionExpired: 'انتهت الجلسة. سجّل الدخول مرة أخرى.',
  },

  /** Field-level validation messages, shared by Zod schemas and the forms. */
  validation: {
    required: 'هذا الحقل مطلوب',
    usernameFormat:
      'اسم المستخدم يبدأ وينتهي بحرف أو رقم لاتيني، ويسمح بالنقطة والشرطة بينهما',
    usernameLength: 'اسم المستخدم بين 3 و32 خانة',
    usernameTaken: 'اسم المستخدم مستخدم بالفعل',
    fullNameRequired: 'الاسم الكامل مطلوب',
    phoneInvalid: 'رقم موبايل مصري غير صحيح. الصيغة المقبولة: 01xxxxxxxxx',
    /** `{min}` is substituted at render time. */
    passwordTooShort: 'كلمة المرور لا تقل عن {min} خانة',
    passwordContainsUsername: 'كلمة المرور يجب ألا تحتوي على اسم المستخدم',
    salaryRequiredForPayType: 'الراتب الشهري مطلوب لهذا النوع من الأجر',
    rateRequiredForPayType: 'أجر المهمة الافتراضي مطلوب لهذا النوع من الأجر',
    amountNegative: 'القيمة لا يمكن أن تكون سالبة',
    amountFormat: 'المبلغ بالأرقام فقط، بحد أقصى خانتان عشريتان',
    capacityRange: 'ساعات الطاقة الأسبوعية بين 1 و168',
    roleNameArRequired: 'اسم الدور بالعربية مطلوب',
    roleNameEnFormat: 'المعرّف الإنجليزي بحروف لاتينية صغيرة وشرطة سفلية فقط',
    roleNameEnTaken: 'المعرّف الإنجليزي مستخدم بالفعل',
    unknownPermission: 'صلاحية غير معروفة',
    dateRangeInvalid: 'تاريخ البداية بعد تاريخ النهاية',
  },

  users: {
    title: 'المستخدمون',
    create: 'مستخدم جديد',
    edit: 'تعديل المستخدم',
    deactivate: 'تعطيل الحساب',
    activate: 'تفعيل الحساب',
    resetPassword: 'إعادة تعيين كلمة المرور',
    resetPasswordHint:
      'ستُطلب من المستخدم كلمة مرور جديدة عند أول تسجيل دخول بعد إعادة التعيين.',
    fullName: 'الاسم الكامل',
    phone: 'رقم الموبايل',
    isWorker: 'منفّذ',
    isWorkerHint: 'يستلم مهاما وتُحتسب له مستحقات. مستقل تماما عن الدور.',
    payType: 'نوع الأجر',
    monthlySalary: 'الراتب الشهري',
    defaultTaskRate: 'أجر المهمة الافتراضي',
    weeklyCapacityHours: 'الطاقة الأسبوعية (ساعات)',
    penaltyProfile: 'صيغة الخصم',
    penaltyProfileDefault: 'الصيغة الافتراضية من الإعدادات',
    roles: 'الأدوار',
    status: 'الحالة',
    noRoles: 'بدون أدوار',
    created: 'تم إنشاء المستخدم',
    updated: 'تم تحديث بيانات المستخدم',
    deactivated: 'تم تعطيل الحساب',
    activated: 'تم تفعيل الحساب',
    passwordReset: 'تمت إعادة تعيين كلمة المرور',
    empty: 'لا يوجد مستخدمون بعد',
    emptyAction: 'أنشئ أول مستخدم',
    searchPlaceholder: 'ابحث بالاسم أو اسم المستخدم',
    /** Deactivation guard — `{tasks}` is the rendered list of open task titles. */
    hasOpenTasks:
      'لا يمكن تعطيل هذا الحساب: لديه مهام مفتوحة يجب إعادة إسنادها أو إغلاقها أولا.',
    openTasksLabel: 'المهام المفتوحة',
    cannotDeactivateSelf: 'لا يمكنك تعطيل حسابك الشخصي',
    cannotDeactivateLastSuperAdmin: 'لا يمكن تعطيل آخر مدير نظام',
    superAdminRoleRestricted: 'منح دور مدير النظام أو نزعه متاح لمدير النظام وحده',
  },

  roles: {
    superAdmin: 'مدير النظام',
    superAdminDescription:
      'دور النظام الأعلى. يملك كل الصلاحيات ضمنيا ولا يمكن تعديله أو حذفه.',
    title: 'الأدوار',
    create: 'دور جديد',
    edit: 'تعديل الدور',
    delete: 'حذف الدور',
    nameAr: 'اسم الدور بالعربية',
    nameEn: 'المعرّف الإنجليزي',
    nameEnHint: 'معرّف ثابت يُستخدم في الكود والسجلات. حروف لاتينية صغيرة وشرطة سفلية.',
    defaultRole: 'الدور الافتراضي للحسابات الجديدة',
    defaultRoleHint: 'يُسنَد تلقائيا عند إنشاء حساب بلا دور محدد.',
    defaultRoleUnsafe: 'الدور الافتراضي لا يمكن أن يحتوي صلاحيات واسعة أو إدارية.',
    description: 'وصف الدور',
    permissions: 'الصلاحيات',
    permissionCount: 'عدد الصلاحيات',
    memberCount: 'عدد المستخدمين',
    created: 'تم إنشاء الدور',
    updated: 'تم تحديث الدور',
    deleted: 'تم حذف الدور',
    empty: 'لا توجد أدوار بعد',
    emptyAction: 'أنشئ أول دور',
    systemRole: 'دور نظام',
    systemRoleLocked: 'دور نظام محمي: لا يمكن تعديله أو حذفه',
    superAdminImplicit: 'يملك كل الصلاحيات ضمنيا، بما فيها الصلاحيات اللي تُضاف لاحقا',
    inUse: 'لا يمكن حذف دور مسنَد إلى مستخدمين. أزل الدور عنهم أولا.',
    assignedUsers: 'المستخدمون المسنَد إليهم هذا الدور',
  },

  clients: {
    title: 'العملاء',
    create: 'عميل جديد',
    edit: 'تعديل العميل',
    name: 'اسم العميل',
    phone: 'رقم الموبايل',
    notes: 'ملاحظات',
    projectCount: 'عدد المشاريع',
    created: 'تم إنشاء العميل',
    updated: 'تم تحديث بيانات العميل',
    deleted: 'تم حذف العميل',
    empty: 'لا يوجد عملاء بعد',
    emptyAction: 'أضف أول عميل',
    searchPlaceholder: 'ابحث باسم العميل',
    deleteTitle: 'حذف العميل',
    deleteDescription:
      'سيُخفى العميل من كل الشاشات. المشاريع المرتبطة به تبقى كما هي وتفقد ربطها بعميل.',
  },

  projects: {
    title: 'المشاريع',
    create: 'مشروع جديد',
    createFromTemplate: 'من قالب',
    edit: 'تعديل المشروع',
    code: 'كود المشروع',
    codeHint: 'يُنشأ تلقائيا، ويمكن تعديله.',
    name: 'اسم المشروع',
    client: 'العميل',
    noClient: 'بدون عميل',
    owner: 'مسؤول المشروع',
    engagementType: 'نوع التعاقد',
    status: 'حالة المشروع',
    startDate: 'تاريخ البدء',
    dueDate: 'الموعد النهائي',
    gracePeriodHours: 'مهلة السماح (ساعات)',
    gracePeriodHint: 'اتركها فارغة لاستخدام القيمة الافتراضية من الإعدادات.',
    penalizeRevisionLateness: 'احتساب تأخير التعديلات',
    penalizeRevisionLatenessHint: 'اتركها بلا تحديد لاستخدام إعداد النظام العام.',
    usesDefault: 'القيمة الافتراضية من الإعدادات',
    created: 'تم إنشاء المشروع',
    updated: 'تم تحديث المشروع',
    deleted: 'تم حذف المشروع',
    empty: 'لا توجد مشاريع بعد',
    emptyAction: 'أنشئ أول مشروع',
    searchPlaceholder: 'ابحث بالاسم أو الكود',
    deleteTitle: 'حذف المشروع',
    deleteDescription:
      'سيُخفى المشروع وكل ما يتبعه من كل الشاشات. القيود المالية والسجلات تبقى كما هي.',
    codeTaken: 'كود المشروع مستخدم بالفعل',
    dateRangeInvalid: 'تاريخ البدء بعد الموعد النهائي',
    facets: {
      status: 'الحالة',
      health: 'الصحة',
      owner: 'المسؤول',
      client: 'العميل',
    },
    tabs: {
      overview: 'نظرة عامة',
      tasks: 'المهام',
      team: 'الفريق',
      timeline: 'الجدول الزمني',
    },
    tasksPlaceholder: {
      title: 'المهام قادمة في مرحلة لاحقة',
      description: 'إدارة المهام والإسناد والتسليم ستُضاف لاحقا لهذا المشروع.',
    },
    health: {
      title: 'صحة المشروع',
      computed: 'المحتسب تلقائيا',
      overrideBadge: 'تقدير يدوي',
      overrideAction: 'ضبط الحالة يدويا',
      clearOverride: 'العودة للاحتساب التلقائي',
      overrideReasonRequired: 'سبب التقدير اليدوي مطلوب',
      overrideSet: 'تم ضبط صحة المشروع يدويا',
      overrideCleared: 'عاد المشروع للاحتساب التلقائي',
      setOverrideTitle: 'ضبط صحة المشروع يدويا',
      clearOverrideTitle: 'إلغاء التقدير اليدوي',
      selectHealth: 'الحالة',
    },
    team: {
      title: 'أعضاء الفريق',
      addMember: 'إضافة عضو',
      role: 'الدور في المشروع',
      removeMember: 'إزالة من الفريق',
      empty: 'لا يوجد أعضاء في الفريق بعد',
      alreadyMember: 'هذا المستخدم عضو بالفعل',
      selectUser: 'اختر مستخدما',
    },
    milestones: {
      title: 'مراحل المشروع',
      add: 'مرحلة جديدة',
      edit: 'تعديل المرحلة',
      name: 'اسم المرحلة',
      dueDate: 'الموعد النهائي',
      status: 'الحالة',
      empty: 'لا توجد مراحل بعد',
      emptyAction: 'أضف أول مرحلة',
      created: 'تمت إضافة المرحلة',
      updated: 'تم تحديث المرحلة',
      deleted: 'تم حذف المرحلة',
      reordered: 'تم إعادة ترتيب المراحل',
      deleteTitle: 'حذف المرحلة',
      deleteDescription: 'سيُحذف هذا العنصر من الجدول الزمني للمشروع نهائيا.',
      moveUp: 'نقل لأعلى',
      moveDown: 'نقل لأسفل',
      dragHandle: 'اسحب لإعادة الترتيب',
    },
    templates: {
      title: 'قوالب المشاريع',
      saveAsTemplate: 'حفظ كقالب',
      saveAsTemplateTitle: 'حفظ المشروع كقالب',
      saveAsTemplateDescription:
        'يُحفظ هيكل مراحل المشروع ليُستخدم عند إنشاء مشاريع جديدة. مهام المشروع ستُضاف للقالب في مرحلة لاحقة.',
      templateName: 'اسم القالب',
      saved: 'تم حفظ القالب',
      createFromTemplateTitle: 'مشروع جديد من قالب',
      selectTemplate: 'اختر قالبا',
      noTemplates: 'لا توجد قوالب محفوظة بعد',
      milestoneCount: 'عدد المراحل',
    },
  },

  tasks: {
    title: 'المهام',
    create: 'مهمة جديدة',
    edit: 'تعديل المهمة',
    taskTitle: 'عنوان المهمة',
    description: 'الوصف',
    project: 'المشروع',
    milestone: 'المرحلة',
    noMilestone: 'بدون مرحلة',
    assignee: 'المنفّذ',
    noAssignee: 'بدون منفّذ',
    watchers: 'المتابعون',
    status: 'الحالة',
    priority: 'الأولوية',
    category: 'التصنيف',
    estimatedHours: 'الساعات التقديرية',
    taskValue: 'قيمة المهمة',
    taskValueHint: 'تُملأ تلقائيا من أجر المهمة الافتراضي للمنفّذ، ويمكن تعديلها.',
    dueDate: 'موعد التسليم',
    originalDueDate: 'الموعد الأصلي',
    qualityRating: 'تقييم الجودة',
    delayReason: 'سبب التأخير',
    delayAttribution: 'مسؤولية التأخير',
    created: 'تم إنشاء المهمة',
    updated: 'تم تحديث المهمة',
    deleted: 'تم حذف المهمة',
    empty: 'لا توجد مهام بعد',
    emptyAction: 'أنشئ أول مهمة',
    deleteTitle: 'حذف المهمة',
    deleteDescription:
      'ستُخفى المهمة من كل الشاشات. الحركات المالية المرتبطة بها تبقى كما هي.',

    /** The state-machine transitions, as the buttons that trigger them. */
    actions: {
      assign: 'إسناد المهمة',
      reassign: 'تغيير المنفّذ',
      start: 'بدء التنفيذ',
      submit: 'تسليم المهمة',
      sendToReview: 'إرسال للمراجعة',
      requestRevision: 'طلب تعديل',
      approve: 'اعتماد المهمة',
      complete: 'إنهاء المهمة',
      block: 'تعليق المهمة',
      unblock: 'استئناف المهمة',
      cancel: 'إلغاء المهمة',
      addWatcher: 'إضافة متابع',
      removeWatcher: 'إزالة متابع',
    },

    assignment: {
      title: 'إسناد المهمة',
      selectAssignee: 'اختر المنفّذ',
      assigned: 'تم إسناد المهمة',
      reassigned: 'تم تغيير منفّذ المهمة',
      /** SPEC M4 — the mid-task reassignment decision. */
      payPreviousTitle: 'صرف مستحق جزئي للمنفّذ السابق؟',
      payPreviousDescription:
        'المهمة كانت قيد التنفيذ. يمكنك صرف مبلغ جزئي للمنفّذ السابق مقابل ما أنجزه، ويُسجَّل كتسوية في حسابه.',
      payPreviousAmount: 'المبلغ الجزئي',
      payPreviousSkip: 'بدون صرف',
      /** `{name}` is substituted at render time. */
      payPreviousNote: 'مستحق جزئي عن مهمة أُعيد إسنادها — المنفّذ السابق {name}',
      watcherAdded: 'تمت إضافة المتابع',
      watcherRemoved: 'تمت إزالة المتابع',
    },

    approval: {
      title: 'اعتماد المهمة',
      ratingLabel: 'تقييم الجودة (1–5)',
      ratingHint: 'يدخل هذا التقييم في حساب مؤشر الأداء، ولا يؤثر على الخصومات.',
      approved: 'تم اعتماد المهمة',
      revisionTitle: 'طلب تعديل',
      revisionReason: 'المطلوب تعديله',
      revisionNewDueDate: 'موعد التسليم الجديد',
      revisionRequested: 'تم طلب التعديل',
    },

    /** Finish-to-start, warning only — never a block (SPEC §4, §5.1). */
    dependencies: {
      title: 'الاعتماديات',
      add: 'إضافة اعتمادية',
      dependsOn: 'تعتمد على',
      dependents: 'مهام تعتمد عليها',
      empty: 'لا توجد اعتماديات',
      added: 'تمت إضافة الاعتمادية',
      removed: 'تمت إزالة الاعتمادية',
      /** `{count}` is substituted at render time. */
      warningTitle: 'هذه المهمة تعتمد على {count} مهمة غير معتمدة',
      warningDescription:
        'يمكنك المتابعة رغم ذلك — الاعتماديات تنبيه وليست قيدا على البدء.',
      warningDismiss: 'متابعة على أي حال',
    },

    comments: {
      title: 'التعليقات',
      placeholder: 'اكتب تعليقا… استخدم @ لذكر زميل',
      submit: 'إضافة تعليق',
      empty: 'لا توجد تعليقات بعد',
      added: 'تمت إضافة التعليق',
      mentionHint: 'اكتب @ ثم اسم المستخدم',
    },

    activity: {
      title: 'سجل المهمة',
      empty: 'لا توجد حركات مسجَّلة',
      system: 'النظام',
      /** One line per `TaskActivityKind` (`modules/task/types.ts`). */
      types: {
        CREATED: 'إنشاء المهمة',
        STATUS_CHANGED: 'تغيير الحالة',
        ASSIGNED: 'تغيير المنفّذ',
        WATCHER_ADDED: 'إضافة متابع',
        WATCHER_REMOVED: 'إزالة متابع',
        COMMENTED: 'إضافة تعليق',
        DUE_DATE_CHANGED: 'تغيير موعد التسليم',
        VALUE_CHANGED: 'تغيير قيمة المهمة',
        UPDATED: 'تعديل بيانات المهمة',
        DEPENDENCY_ADDED: 'إضافة اعتمادية',
        DEPENDENCY_REMOVED: 'إزالة اعتمادية',
        ELAPSED_RECOMPUTED: 'إعادة احتساب الزمن',
      },
    },

    elapsed: {
      raw: 'الزمن المنقضي',
      working: 'زمن العمل الفعلي',
      /** `{hours}`/`{minutes}` are substituted at render time. */
      hoursMinutes: '{hours} س {minutes} د',
      notStarted: 'لم يبدأ بعد',
      hint: 'زمن العمل يستبعد العطلات الأسبوعية والأجازات الرسمية وإجازات المنفّذ المعتمدة.',
    },

    /** Phase 5 — the three interchangeable task views. */
    views: {
      board: 'لوحة',
      list: 'قائمة',
      calendar: 'تقويم',
    },

    overdue: 'متأخرة',
    unassigned: 'بدون منفّذ',
    mine: 'مهامي',
    searchPlaceholder: 'ابحث في عناوين المهام…',
    /** `{count}` is substituted at render time. */
    truncatedNotice: 'تُعرض أول {count} مهمة فقط — ضيّق التصفية لرؤية الباقي',

    facets: {
      project: 'المشروع',
      assignee: 'المنفّذ',
      status: 'الحالة',
      priority: 'الأولوية',
      category: 'التصنيف',
      overdueOnly: 'المتأخرة فقط',
      /**
       * "Soon", not "this week": the horizon is `tasks.dueSoonDays` and an
       * operator may move it (Phase 12). A label that named a week would
       * become a lie the moment they did.
       */
      dueSoon: 'مستحقة قريبا',
    },

    board: {
      addTask: 'إضافة مهمة',
      emptyColumn: 'لا توجد مهام',
      /** `{count}` is substituted at render time. */
      moreCards: 'و{count} مهمة أخرى',
      illegalDrop: 'لا يمكن نقل المهمة إلى هذه الحالة مباشرة',
      dropHint: 'أفلت هنا لنقل المهمة',
    },

    list: {
      bulkAssign: 'إسناد جماعي',
      bulkPriority: 'تغيير الأولوية',
      bulkDueDate: 'تغيير موعد التسليم',
      /** `{count}` is substituted at render time. */
      bulkApplied: 'تم تحديث {count} مهمة',
      /** `{count}` is substituted at render time. */
      bulkPartial: 'تم تحديث {count} وتعذّر تحديث الباقي',
      bulkFailed: 'تعذّر تنفيذ الإجراء الجماعي',
      selectRow: 'تحديد المهمة',
      selectAllPage: 'تحديد كل مهام هذه الصفحة',
    },

    calendarView: {
      month: 'شهر',
      week: 'أسبوع',
      today: 'اليوم',
      previousPeriod: 'الفترة السابقة',
      nextPeriod: 'الفترة التالية',
      /** `{count}` is substituted at render time. */
      moreOnDay: 'و{count} أخرى',
      empty: 'لا توجد مهام مستحقة في هذه الفترة',
    },

    quickCreate: {
      title: 'مهمة سريعة',
      submit: 'إنشاء',
      selectProject: 'اختر المشروع',
      selectCategory: 'اختر التصنيف',
    },

    detail: {
      tabs: {
        details: 'التفاصيل',
        dependencies: 'الاعتماديات',
        comments: 'التعليقات',
        activity: 'السجل',
        penalty: 'الخصم',
        extensions: 'التمديد',
      },
    },

    watcherPicker: {
      title: 'إضافة متابع',
      placeholder: 'اختر مستخدما',
      empty: 'لا يوجد مستخدمون آخرون لإضافتهم',
    },

    dependencyPicker: {
      placeholder: 'اختر مهمة',
      empty: 'لا توجد مهام أخرى في هذا المشروع',
    },

    errors: {
      /** `{from}`/`{to}` are substituted at render time. */
      illegalTransition: 'لا يمكن نقل المهمة من "{from}" إلى "{to}"',
      unknownCategory: 'تصنيف المهمة غير موجود في الإعدادات',
      milestoneNotInProject: 'المرحلة المختارة لا تتبع هذا المشروع',
      assigneeRequired: 'يجب اختيار منفّذ للمهمة',
      assigneeInactive: 'لا يمكن إسناد مهمة لحساب معطّل أو محذوف',
      assigneeUnchanged: 'المهمة مُسندة بالفعل لهذا المنفّذ',
      sameAssigneeAsWatcher: 'منفّذ المهمة متابع لها تلقائيا',
      selfDependency: 'لا يمكن أن تعتمد المهمة على نفسها',
      reciprocalDependency: 'المهمتان لا يمكن أن تعتمد كل منهما على الأخرى',
      duplicateDependency: 'هذه الاعتمادية مضافة بالفعل',
      ratingRange: 'تقييم الجودة بين 1 و5',
      ratingRequired: 'تقييم الجودة مطلوب عند الاعتماد',
      notBlocked: 'المهمة ليست معلَّقة',
      noPreviousStatus: 'لا توجد حالة سابقة لاستئناف المهمة إليها',
      partialAmountRequiresPreviousAssignee: 'لا يوجد منفّذ سابق لصرف مستحق له',
      partialAmountInvalid: 'المبلغ الجزئي لازم يكون أكبر من صفر',
      partialAmountTooLarge: 'المبلغ الجزئي يتجاوز قيمة المهمة',
      commentEmpty: 'التعليق فارغ',
    },
  },

  /** Phase 6 — the work calendar, holidays, leave, extensions and lateness. */
  calendar: {
    title: 'التقويم وأيام العمل',
    weekendDays: 'أيام الإجازة الأسبوعية',
    workdayStart: 'بداية يوم العمل',
    workdayEnd: 'نهاية يوم العمل',
    workingDaysPerMonth: 'أيام العمل في الشهر',
    workingDay: 'يوم عمل',
    nonWorkingDay: 'يوم إجازة',
    /** `{count}` is substituted at render time. */
    workingDaysCount: '{count} يوم عمل',
    errors: {
      invalidDate: 'تاريخ غير صالح',
      invalidTime: 'صيغة الوقت غير صالحة، المطلوب HH:mm',
      noWorkingDay:
        'لا يوجد يوم عمل ضمن المدى المسموح. راجع أيام العمل والعطلات في الإعدادات.',
      rangeTooLarge: 'المدى الزمني المطلوب أكبر مما يسمح به التقويم',
    },
  },

  holidays: {
    title: 'العطلات الرسمية',
    subtitle: 'الأيام اللي لا يُحتسب فيها تأخير ولا وقت عمل.',
    create: 'عطلة جديدة',
    edit: 'تعديل العطلة',
    name: 'اسم العطلة',
    date: 'التاريخ',
    recurring: 'تتكرر كل سنة',
    recurringHint:
      'العطلات ذات التاريخ الميلادي الثابت فقط. الأعياد الهجرية تُضاف لكل سنة.',
    empty: 'لا توجد عطلات مسجَّلة',
    year: 'السنة',
    import: 'استيراد عطلات',
    importPreview: 'معاينة الاستيراد',
    importSummary: 'سيتم إضافة {created} عطلة، وتخطّي {skipped}، ورفض {invalid}.',
    errors: {
      duplicate: 'هذا اليوم مسجَّل كعطلة بالفعل',
      nameRequired: 'اسم العطلة مطلوب',
      notFound: 'العطلة غير موجودة',
    },
  },

  leave: {
    title: 'الإجازات',
    subtitle: 'إجازات المنفّذين المعتمدة لا يُحتسب فيها تأخير.',
    request: 'طلب إجازة',
    record: 'تسجيل إجازة',
    edit: 'تعديل الإجازة',
    worker: 'المنفّذ',
    type: 'نوع الإجازة',
    startDate: 'من تاريخ',
    endDate: 'إلى تاريخ',
    note: 'ملاحظة',
    decisionNote: 'سبب القرار',
    approve: 'اعتماد',
    reject: 'رفض',
    approvedBy: 'اعتمدها',
    decidedAt: 'تاريخ القرار',
    days: 'عدد الأيام',
    empty: 'لا توجد إجازات مسجَّلة',
    /** `{name}`, `{from}` and `{to}` are substituted at render time. */
    assignWarning: '{name} في إجازة معتمدة من {from} إلى {to} خلال مدة هذه المهمة',
    status: {
      PENDING: 'قيد المراجعة',
      APPROVED: 'معتمدة',
      REJECTED: 'مرفوضة',
    },
    errors: {
      overlap: 'توجد إجازة أخرى لنفس المنفّذ في هذه الفترة',
      rangeInvalid: 'تاريخ البداية بعد تاريخ النهاية',
      unknownType: 'نوع الإجازة غير موجود في الإعدادات',
      alreadyDecided: 'تم البتّ في هذه الإجازة بالفعل',
      notFound: 'الإجازة غير موجودة',
      subjectInactive: 'لا يمكن تسجيل إجازة لحساب معطّل أو محذوف',
      notOwn: 'لا يمكنك طلب إجازة نيابة عن مستخدم آخر',
    },
  },

  extensions: {
    title: 'طلبات التمديد',
    request: 'طلب تمديد',
    newDueDate: 'موعد التسليم الجديد',
    oldDueDate: 'موعد التسليم الحالي',
    reason: 'سبب التمديد',
    approve: 'اعتماد التمديد',
    reject: 'رفض التمديد',
    decisionNote: 'سبب القرار',
    requestedBy: 'مقدّم الطلب',
    decidedBy: 'صاحب القرار',
    empty: 'لا توجد طلبات تمديد',
    approved: 'تم اعتماد التمديد وتحديث موعد التسليم',
    rejected: 'تم رفض طلب التمديد',
    status: {
      PENDING: 'قيد المراجعة',
      APPROVED: 'معتمد',
      REJECTED: 'مرفوض',
    },
    errors: {
      notLater: 'موعد التسليم الجديد لازم يكون بعد الموعد الحالي',
      alreadyPending: 'يوجد طلب تمديد قيد المراجعة لهذه المهمة',
      alreadyDecided: 'تم البتّ في هذا الطلب بالفعل',
      stale: 'تغيّر موعد تسليم المهمة بعد تقديم الطلب. قدّم طلبا جديدا.',
      notFound: 'طلب التمديد غير موجود',
      notAssignee: 'طلب التمديد يقدّمه منفّذ المهمة',
      taskDelivered: 'لا يمكن تمديد مهمة تم تسليمها أو إغلاقها',
      reasonRequired: 'سبب التمديد مطلوب',
    },
  },

  /** SPEC §5.3 — the lateness breakdown a منفّذ reads on their own task. */
  lateness: {
    title: 'التأخير',
    dueDate: 'موعد التسليم',
    graceHours: 'مهلة السماح',
    effectiveDueDate: 'الموعد بعد المهلة',
    measuredAt: 'محسوب حتى',
    workingDaysLate: 'أيام العمل المتأخرة',
    onTime: 'سُلّمت في الموعد',
    frozen: 'توقّف احتساب التأخير عند التسليم',
    extended: 'موعد التسليم مُمدَّد',
    originalDueDate: 'الموعد الأصلي',
    /** `{hours}` is substituted at render time. */
    graceHoursValue: '{hours} ساعة',
    escalation: {
      NONE: 'لا تصعيد',
      PM: 'أُبلغ مدير المشروع',
      ADMIN: 'أُبلغت الإدارة',
    },
  },

  /** Phase 7 — the money slice (SPEC §4 "Money", §5.5). */
  ledger: {
    title: 'الحركات المالية',
    myEarnings: 'مستحقاتي',
    subtitle: 'كل حركة مالية تخصّك، بترتيب زمني، لا تُعدَّل ولا تُحذف.',
    balance: 'الرصيد الحالي',
    balanceHint: 'مجموع كل الحركات. الرصيد السالب يُخصم من الدورة القادمة.',
    type: 'نوع الحركة',
    amount: 'المبلغ',
    note: 'البيان',
    date: 'التاريخ',
    task: 'المهمة',
    createdBy: 'سجّلها',
    automatic: 'تلقائي',
    manual: 'يدوي',
    reversed: 'معكوس',
    reversedNotice: 'عُكس هذا القيد بقيد لاحق.',
    empty: 'لا توجد حركات مالية بعد',
    emptyHint: 'ستظهر هنا استحقاقات المهام والرواتب والخصومات والمكافآت والسلف.',
    currentCycle: 'الدورة الحالية',
    currentCycleHint: 'ما تحرّك منذ آخر إغلاق. تُصرف عند إغلاق الدورة.',
    outstanding: 'مستحقات لم تُصرف بعد',
    allTypes: 'كل الأنواع',
    /** Notes persisted onto the entries themselves — the منفّذ reads these. */
    notes: {
      taskEarning: 'استحقاق اعتماد مهمة "{task}"',
      taskCancelled: 'عكس استحقاق مهمة ملغاة: {reason}',
      salary: 'راتب دورة الصرف',
      payout: 'صرف مستحقات بمبلغ {amount}',
    },
    errors: {
      amountZero: 'لا يُسجَّل قيد بمبلغ صفر',
      amountScale: 'المبلغ لا يقبل أكثر من خانتين عشريتين',
      amountOutOfRange: 'المبلغ خارج النطاق المسموح',
      mustBeCredit: 'هذا النوع من الحركات لازم يكون مبلغه موجبا',
      mustBeDebit: 'هذا النوع من الحركات لازم يكون مبلغه سالبا',
      magnitudeMustBePositive: 'المبلغ لازم يكون أكبر من صفر',
      signedAmountRequired: 'يجب تحديد اتجاه المبلغ لهذا النوع صراحة',
      noteRequired: 'بيان الحركة مطلوب',
      reasonRequired: 'السبب مطلوب',
      alreadyReversed: 'هذا القيد معكوس بالفعل',
      cannotReverseReversal: 'لا يمكن عكس قيد عكسي. سجّل قيد تسوية جديدا.',
      cycleAlreadyPaid: 'لا يمكن عكس قيد من دورة صُرفت بالفعل. استخدم قيد تسوية.',
      cannotReversePayout: 'لا يُعكس قيد صرف. سجّل قيد تسوية بالمبلغ المسترد.',
      notHumanReversible:
        'هذا النوع من القيود لا يُعكس يدويا. استخدم قيد تسوية مع ذكر السبب.',
    },
  },

  payouts: {
    title: 'المستحقات',
    subtitle: 'دورات الصرف وما استحقّه كل منفّذ فيها.',
    cycle: 'دورة الصرف',
    cycles: 'دورات الصرف',
    period: 'الفترة',
    periodStart: 'من',
    periodEnd: 'إلى',
    closedAt: 'أُغلقت في',
    closedBy: 'أغلقها',
    closeCycle: 'إغلاق الدورة الآن',
    closeCycleConfirm:
      'سيتم إغلاق الدورة الحالية وتوليد مستحقات مسودة لكل منفّذ. لا يمكن التراجع.',
    closeCycleDone: 'أُغلقت الدورة وتم توليد {count} مستحقا.',
    closeCycleLocked: 'هناك إغلاق جاري بالفعل. حاول بعد قليل.',
    worker: 'المنفّذ',
    carriedForward: 'مرحّل من السابق',
    gross: 'الإجمالي',
    penalties: 'الخصومات',
    bonuses: 'المكافآت',
    advances: 'السلف',
    adjustments: 'التسويات',
    net: 'الصافي',
    paidAmount: 'المصروف',
    outstanding: 'المتبقي',
    approve: 'اعتماد',
    markPaid: 'تسجيل صرف',
    method: 'طريقة الصرف',
    reference: 'رقم المرجع',
    paymentNote: 'ملاحظة',
    amountToPay: 'المبلغ المصروف',
    partialHint: 'يمكن صرف جزء من المستحق، والباقي يظل مستحقا ويظهر في الدورة القادمة.',
    payoutCount: 'عدد المستحقات',
    totalNet: 'إجمالي الصافي',
    totalPaid: 'إجمالي المصروف',
    empty: 'لا توجد دورات صرف بعد',
    emptyHint: 'تُفتح أول دورة تلقائيا مع أول حركة مالية.',
    noPayouts: 'لا توجد مستحقات في هذه الدورة',
    statement: 'كشف الحساب',
    breakdown: 'تفصيل الحساب',
    breakdownHint:
      'الصافي = المرحّل + الإجمالي − الخصومات + المكافآت − السلف + التسويات، وبحد أدنى صفر.',
    flooredAtZero:
      'الخصومات تجاوزت الاستحقاقات، فالمستحق صفر والفرق مُرحَّل للدورة القادمة.',
    errors: {
      notDraft: 'لا يمكن اعتماد مستحق تجاوز حالة المسودة',
      notApproved: 'يجب اعتماد المستحق قبل تسجيل الصرف',
      alreadyPaid: 'هذا المستحق مصروف بالكامل',
      exceedsOutstanding: 'المبلغ أكبر من المتبقي على هذا المستحق',
      exceedsBalance: 'المبلغ أكبر من رصيد المنفّذ الحالي. قد يكون صُرف ضمن دورة أخرى.',
      negativeAmount: 'لا يمكن صرف مبلغ سالب',
      amountRequired: 'يجب تحديد مبلغ أكبر من صفر',
      methodRequired: 'طريقة الصرف مطلوبة',
      unknownMethod: 'طريقة الصرف غير موجودة في الإعدادات',
      cycleNotOpen: 'دورة الصرف مغلقة بالفعل',
      concurrentPayment: 'سُجّل صرف آخر لهذا المستحق في نفس اللحظة. راجع المبلغ المتبقي.',
    },
  },

  advances: {
    title: 'السلف',
    create: 'تسجيل سلفة',
    amount: 'مبلغ السلفة',
    note: 'سبب السلفة',
    hint: 'تُسجَّل السلفة كخصم فوري من الرصيد، وتُسدَّد تلقائيا من المستحقات القادمة.',
    created: 'سُجّلت السلفة',
  },

  adjustments: {
    title: 'التسويات',
    create: 'تسجيل تسوية',
    amount: 'المبلغ (سالب للخصم)',
    reason: 'سبب التسوية',
    hint: 'قيد يدوي موقّع، يُستخدم لتصحيح ما لا يصح عكسه.',
    created: 'سُجّلت التسوية',
  },

  /** Phase 8 — the penalty engine (SPEC §5.4). */
  penalties: {
    title: 'الخصومات والمكافآت',
    subtitle: 'كل خصم محسوب آليا من موعد التسليم وأيام العمل المتأخرة، لا من تقدير أحد.',
    penalty: 'خصم',
    penalties: 'الخصومات',
    register: 'سجل الخصومات والمكافآت',
    breakdown: 'تفصيل الحساب',
    breakdownHint: 'هذه حسبة النظام. الأرقام كلها ظاهرة، ويمكن إعادتها يدويا.',
    automatic: 'خصم تلقائي',
    manual: 'خصم يدوي',
    worker: 'المنفّذ',
    task: 'المهمة',
    amount: 'المبلغ',
    date: 'التاريخ',
    reason: 'السبب',
    recordedBy: 'سجّلها',
    create: 'تسجيل خصم يدوي',
    created: 'سُجّل الخصم',
    /** SPEC §5.4 / phase brief item 5: free text only, no reason taxonomy. */
    reasonLabel: 'سبب الخصم',
    reasonPlaceholder: 'اكتب السبب كاملا — يقرأه المنفّذ كما هو',
    reasonOnlyOther: 'السبب نص حر. لا توجد قائمة أسباب جاهزة.',
    empty: 'لا توجد خصومات أو مكافآت',
    emptyHint: 'الخصومات التلقائية تظهر هنا فور تجاوز موعد التسليم ومهلة السماح.',
    noPenaltyForTask: 'لا يوجد خصم على هذه المهمة',
    onTime: 'لا تأخير على هذه المهمة، فلا خصم.',
    frozen: 'مجمَّد',
    frozenHint: 'توقّف الاحتساب عند التسليم. لا يزيد بعد ذلك.',
    live: 'قيد الاحتساب',
    liveHint: 'يزيد كل يوم عمل حتى التسليم.',
    /** The per-round labels SPEC T4 asks for. `{n}` is substituted. */
    originalDelivery: 'التسليم الأصلي',
    revisionRound: 'المراجعة رقم {n}',
    revisionSeparate: 'خصم المراجعة يُحتسب على حدة من الموعد الجديد.',
    revisionNotPenalized: 'خصم تأخير المراجعات موقوف في هذا المشروع.',
    profile: 'صيغة الخصم',
    profileDefault: 'الافتراضي العام',
    /** Column headings inside the breakdown panel. */
    fields: {
      dueDate: 'موعد التسليم',
      graceHours: 'مهلة السماح',
      effectiveDueDate: 'يبدأ التأخير من',
      lateWorkingDays: 'أيام العمل المتأخرة',
      blockedWorkingDays: 'أيام معذورة (متوقفة)',
      mode: 'طريقة الحساب',
      basis: 'الأساس',
      formula: 'المعادلة',
      amount: 'المبلغ المخصوم',
    },
    basis: {
      FIXED: 'مبلغ ثابت',
      TASK_VALUE: 'قيمة المهمة',
      DAILY_RATE: 'الراتب اليومي',
    },
    basisFallback: 'قيمة المهمة غير متاحة لهذا المنفّذ، فاحتُسب الخصم من {basis}.',
    noBasis: 'تعذّر احتساب الخصم: لا قيمة للمهمة ولا راتب يومي مسجَّل لهذا المنفّذ.',
    /**
     * The formula as the منفّذ reads it. Every term is exact, so the arithmetic
     * can be reproduced by hand and land on the same number — which is why the
     * daily-rate term below shows `salary ÷ days` rather than a rounded rate.
     *
     * Composed from a basis term and a shape, **not** keyed by mode. A mode
     * names the basis it *wants*; when that figure does not exist for this
     * منفّذ the engine multiplies the other one (`modules/penalty/basis.ts`),
     * and a template chosen by mode would then describe an arithmetic that did
     * not happen. Composing also covers the pairs the enum does not name, such
     * as a one-off percentage of a daily rate.
     */
    formulas: {
      fixedPerDay: '{value} × {days} يوم عمل',
      fixedOnce: '{value} (مرة واحدة)',
      percentPerDay: '{basis} × {value}% × {days} يوم عمل',
      percentOnce: '{basis} × {value}%',
    },
    /** The term that stands in for `{basis}` above. */
    basisTerms: {
      amount: '{amount}',
      dailyRate: '({salary} ÷ {perMonth})',
    },
    /** Notes persisted onto the ledger entries themselves. */
    notes: {
      auto:
        'خصم تأخير مهمة «{task}» — موعد التسليم {due}، مهلة {grace} ساعة، ' +
        '{days} يوم عمل تأخير. الحساب: {formula} = {amount}',
      autoRevision:
        'خصم تأخير {round} لمهمة «{task}» — الموعد الجديد {due}، مهلة {grace} ساعة، ' +
        '{days} يوم عمل تأخير. الحساب: {formula} = {amount}',
      recalculated: 'إعادة احتساب خصم مهمة «{task}»: {cause}',
      manual: 'خصم يدوي: {reason}',
    },
    causes: {
      extensionApproved: 'اعتماد تمديد نقل موعد التسليم',
      statusChanged: 'تغيّر حالة المهمة',
      scheduled: 'إعادة الحساب اليومية',
      manual: 'إعادة حساب يدوية',
    },
    reverse: {
      action: 'عكس الخصم',
      title: 'عكس خصم',
      reason: 'سبب العكس',
      reasonHint: 'إلزامي. يظهر للمنفّذ في كشف حسابه كما كُتب.',
      confirm: 'سيُضاف قيد عكسي بنفس المبلغ. القيد الأصلي يبقى في السجل ولا يُحذف.',
      done: 'عُكس الخصم',
      doneBonus: 'عُكست المكافأة',
    },
    errors: {
      reasonRequired: 'سبب الخصم مطلوب',
      reverseReasonRequired: 'سبب العكس مطلوب',
      amountRequired: 'مبلغ الخصم مطلوب ولازم يكون أكبر من صفر',
      userRequired: 'يجب تحديد المنفّذ',
      notPenalty: 'هذا القيد ليس خصما',
      taskNotFound: 'المهمة غير موجودة',
      recomputeLocked: 'جاري إعادة احتساب خصم هذه المهمة الآن. حاول بعد قليل.',
    },
  },

  /** Phase 8 — bonuses are manual only (SPEC §5.4, phase brief item 6). */
  bonuses: {
    title: 'المكافآت',
    bonus: 'مكافأة',
    create: 'تسجيل مكافأة',
    created: 'سُجّلت المكافأة',
    amount: 'مبلغ المكافأة',
    reason: 'سبب المكافأة',
    reasonHint: 'نص حر. يقرأه المنفّذ في كشف حسابه كما كُتب.',
    hint: 'المكافآت يدوية دائما. لا يوجد حساب آلي يمنحها.',
    empty: 'لا توجد مكافآت',
    errors: {
      amountRequired: 'مبلغ المكافأة مطلوب ولازم يكون أكبر من صفر',
      reasonRequired: 'سبب المكافأة مطلوب',
    },
  },

  /** Phase 8 shipped SPEC R4's one report. Phase 10 owns the rest. */
  reports: {
    title: 'التقارير',
    subtitle: 'تقارير جاهزة للتصدير بصيغة Excel — لكل تقرير صلاحيته الخاصة.',
    export: 'تصدير Excel',
    exporting: 'جاري التصدير…',
    exportFailed: 'تعذّر تصدير التقرير',
    /** `lib/xlsx`'s fallback when a sheet name is empty after stripping Excel's reserved characters. */
    defaultSheetName: 'ورقة',
    deductions: 'الخصومات كإيراد',
    /**
     * SPEC §1: "Deductions are reported as organization income in reports only. **No
     * profit/margin math anywhere.**" The wording says what the number *is*,
     * and deliberately gives the reader nothing to divide it by.
     */
    deductionsAsIncome: 'صافي الخصومات المحتجزة — يُحتسب إيرادا للوكالة.',
    period: 'الفترة',
    from: 'من',
    to: 'إلى',
    groupBy: 'التجميع حسب',
    groups: {
      month: 'الشهر',
      cycle: 'دورة الصرف',
      project: 'المشروع',
      worker: 'المنفّذ',
    },
    grossPenalties: 'إجمالي الخصومات',
    reversedPenalties: 'المعكوس منها',
    netPenalties: 'الصافي',
    entryCount: 'عدد القيود',
    empty: 'لا توجد خصومات في هذه الفترة',

    /** Phase 10 — the `/reports` hub linking every report, this one included. */
    hub: {
      payoutStatement: 'كشف المستحقات',
      payoutStatementHint: 'كشف كل منفّذ في دورة صرف محددة.',
      projectSummary: 'ملخص المشاريع',
      projectSummaryHint: 'المهام ونسبة الإنجاز والمتأخر والحالة الصحية لكل مشروع.',
      workerPerformance: 'أداء المنفّذين',
      workerPerformanceHint: 'مؤشر الأداء ومكوّناته لكل منفّذ نشط.',
      virallapSummary: 'الملخص الشهري',
      virallapSummaryHint:
        'المهام المكتملة، إجمالي المدفوع، الخصومات كإيراد، ونسبة الالتزام بالمواعيد.',
      deductions: 'الخصومات كإيراد',
      deductionsHint: 'إجمالي الخصومات المحتجزة، مُحتسبة إيرادا لـ Virallap.',
    },

    payoutStatement: {
      title: 'كشف المستحقات',
      selectCycle: 'دورة الصرف',
      sheetName: 'كشف المستحقات',
      columns: {
        worker: 'المنفّذ',
        username: 'اسم المستخدم',
        carriedForward: 'مرحّل من السابق',
        gross: 'الإجمالي',
        penalties: 'الخصومات',
        bonuses: 'المكافآت',
        advances: 'السلف',
        adjustments: 'تسويات',
        net: 'الصافي',
        paid: 'المدفوع',
        outstanding: 'المتبقي',
        status: 'الحالة',
        method: 'طريقة الصرف',
        paidAt: 'تاريخ الصرف',
      },
      empty: 'لا توجد مستحقات في هذه الدورة',
    },

    projectSummary: {
      title: 'ملخص المشاريع',
      sheetName: 'ملخص المشاريع',
      columns: {
        code: 'الكود',
        name: 'اسم المشروع',
        status: 'الحالة',
        health: 'الحالة الصحية',
        totalTasks: 'إجمالي المهام',
        completedTasks: 'المهام المكتملة',
        overdueTasks: 'المهام المتأخرة',
        completionPercent: 'نسبة الإنجاز',
      },
      empty: 'لا توجد مشاريع',
    },

    workerPerformance: {
      title: 'أداء المنفّذين',
      sheetName: 'أداء المنفّذين',
      columns: {
        worker: 'المنفّذ',
        username: 'اسم المستخدم',
        score: 'المؤشر العام',
        onTimeRate: 'الالتزام بالمواعيد',
        qualityScore: 'تقييم الجودة',
        volumeScore: 'حجم الإنجاز',
        estimateAccuracy: 'دقة التقدير',
        taskCount: 'عدد المهام المكتملة',
        computedAt: 'تاريخ آخر احتساب',
      },
      neverComputed: 'لم يُحتسب بعد',
      empty: 'لا يوجد منفّذون نشطون',
    },

    virallapSummary: {
      title: 'الملخص الشهري',
      sheetName: 'الملخص الشهري',
      month: 'الشهر',
      completedTasks: 'المهام المكتملة',
      totalPaid: 'إجمالي المدفوع',
      totalDeductions: 'إجمالي الخصومات (إيراد)',
      onTimeRate: 'نسبة الالتزام بالمواعيد',
    },
  },

  /**
   * Phase 11 — bulk `.xlsx` import (SPEC §10). `columns` mirrors
   * `modules/import/columns.ts` exactly: each entity's field list, in the
   * template's column order, each carrying the header shown in the sheet and
   * the one-line hint shown on the instructions sheet next to it.
   */
  import: {
    title: 'استيراد البيانات',
    subtitle:
      'نزّل القالب، املأه، ثم عاين النتيجة قبل التأكيد. لا يُحفظ شيء قبل التأكيد.',
    entityLabel: 'نوع البيانات',
    entities: {
      users: 'المستخدمون',
      clients: 'العملاء',
      projects: 'المشاريع',
      tasks: 'المهام',
    },
    actions: {
      downloadTemplate: 'تنزيل قالب Excel',
      chooseFile: 'اختيار ملف',
      changeFile: 'اختيار ملف آخر',
      runDryRun: 'معاينة الاستيراد',
      confirmImport: 'تأكيد الاستيراد وحفظ البيانات',
      startOver: 'البدء من جديد',
    },
    fileLabel: 'ملف Excel (.xlsx)',
    noFileChosen: 'لسه مفيش ملف مختار',
    rowStatus: {
      create: 'سيُنشأ',
      update: 'سيُحدَّث',
      invalid: 'غير صالح',
    },
    preview: {
      title: 'معاينة الاستيراد',
      row: 'الصف',
      status: 'الحالة',
      summary: 'البيانات',
      errors: 'الأخطاء',
      totalRows: 'إجمالي الصفوف',
      toCreate: 'سيتم إنشاؤها',
      toUpdate: 'سيتم تحديثها',
      invalidCount: 'صفوف غير صالحة',
      noValidRows: 'لا توجد صفوف صالحة — لا شيء للتأكيد',
    },
    result: {
      title: 'اكتمل الاستيراد',
      created: 'تم إنشاؤها',
      updated: 'تم تحديثها',
      skipped: 'تم تجاهلها (غير صالحة)',
    },
    errors: {
      fileRequired: 'من فضلك اختر ملف Excel أولا',
      invalidFile: 'تعذّرت قراءة الملف. تأكد أنه بصيغة xlsx صحيحة وغير تالف',
      wrongTemplate:
        'هذا الملف لا يطابق قالب الاستيراد الحالي لهذا النوع من البيانات — نزّل قالبا جديدا',
      emptyFile: 'الملف لا يحتوي على أي صف بيانات',
      /** `{maxMb}` substituted at render time. */
      fileTooLarge: 'حجم الملف أكبر من الحد المسموح ({maxMb} ميجابايت)',
      /** `{max}` substituted at render time. */
      tooManyRows: 'عدد صفوف الملف أكبر من الحد المسموح ({max} صفا)',
      duplicateInFile: 'قيمة مكررة داخل الملف',
      unresolvedProject: 'مفيش مشروع بالكود ده',
      unresolvedUser: 'مفيش مستخدم بالاسم ده',
      unresolvedClient: 'مفيش عميل بالاسم ده',
      ambiguousClient:
        'يوجد أكثر من عميل بهذا الاسم — استخدم اسما فريدا أو عدّله من شاشة العملاء',
      invalidOption: 'قيمة غير موجودة ضمن الخيارات المتاحة لهذا العمود',
      inactiveAssignee: 'حساب هذا المنفّذ معطّل',
      staleImport:
        'تغيّرت البيانات منذ المعاينة الأخيرة، من فضلك أعد المعاينة قبل التأكيد',
    },
    meta: {
      sheetName: 'معلومات القالب',
      field: 'الحقل',
      value: 'القيمة',
      entityRow: 'نوع البيانات',
      versionRow: 'إصدار القالب',
    },
    instructions: {
      sheetName: 'تعليمات',
      title: 'تعليمات تعبئة القالب',
      intro:
        'لا تُغيّر أسماء الأعمدة في ورقة البيانات ولا ترتيبها. الصف الثاني في ورقة البيانات مثال — عدّله أو احذفه. كل عمود بأدناه إلزامي إلا إن ذُكر خلاف ذلك.',
      column: 'العمود',
      required: 'إلزامي؟',
      explanation: 'الشرح',
      requiredYes: 'نعم',
      requiredNo: 'لا',
    },
    columns: {
      users: {
        username: {
          header: 'اسم المستخدم',
          hint: 'حروف لاتينية صغيرة وأرقام فقط. هو المفتاح: يوجد مستخدم بنفس الاسم؟ يتم تحديث بياناته بدل إنشاء حساب جديد.',
          sample: 'ahmed.hassan',
        },
        fullName: {
          header: 'الاسم الكامل',
          hint: 'الاسم الظاهر في النظام.',
          sample: 'أحمد حسن',
        },
        password: {
          header: 'كلمة المرور',
          hint: 'إلزامية عند إنشاء حساب جديد فقط — تُتجاهل تماما عند تحديث حساب موجود.',
          sample: 'Passw0rd123',
        },
        phone: {
          header: 'رقم الهاتف',
          hint: 'رقم موبايل مصري، مثل 01012345678. اختياري.',
          sample: '01012345678',
        },
        isWorker: {
          header: 'منفّذ؟',
          hint: 'نعم أو لا — هل يُسنَد له مهام ويُصرف له أجر؟',
          sample: 'نعم',
        },
        payType: {
          header: 'نوع الأجر',
          hint: 'مطلوب فقط إذا كان "منفّذ؟" = نعم.',
          sample: 'بالمهمة',
        },
        monthlySalary: {
          header: 'الراتب الشهري',
          hint: 'مطلوب لنوع الأجر "راتب شهري" أو "مختلط".',
          sample: '',
        },
        defaultTaskRate: {
          header: 'سعر المهمة الافتراضي',
          hint: 'مطلوب لنوع الأجر "بالمهمة" أو "مختلط".',
          sample: '500.00',
        },
        weeklyCapacityHours: {
          header: 'ساعات العمل الأسبوعية',
          hint: 'اختياري، الافتراضي 40.',
          sample: '40',
        },
      },
      clients: {
        name: {
          header: 'اسم العميل',
          hint: 'الاسم الظاهر على مشاريعه.',
          sample: 'شركة النخبة',
        },
        phone: { header: 'رقم الهاتف', hint: 'اختياري.', sample: '01099999999' },
        notes: { header: 'ملاحظات', hint: 'اختياري.', sample: 'عميل تجريبي' },
      },
      projects: {
        code: {
          header: 'كود المشروع',
          hint: 'اتركه فارغا لإنشاء كود تلقائي. إن طابق كود مشروع موجود، يُحدَّث ذلك المشروع بدل إنشاء واحد جديد.',
          sample: '',
        },
        name: {
          header: 'اسم المشروع',
          hint: '',
          sample: 'موقع الشركة الإلكتروني',
        },
        clientName: {
          header: 'اسم العميل',
          hint: 'اختياري. لازم يطابق اسم عميل موجود بالضبط.',
          sample: 'شركة النخبة',
        },
        ownerUsername: {
          header: 'اسم مستخدم مالك المشروع',
          hint: 'اسم مستخدم موجود بالنظام.',
          sample: 'ahmed.hassan',
        },
        engagementType: { header: 'نوع التعاقد', hint: '', sample: 'سعر ثابت' },
        status: {
          header: 'حالة المشروع',
          hint: 'اختياري، الافتراضي "مسودة".',
          sample: '',
        },
        startDate: {
          header: 'تاريخ البدء',
          hint: 'بصيغة YYYY-MM-DD، مثل 2026-09-01.',
          sample: '2026-09-01',
        },
        dueDate: {
          header: 'تاريخ التسليم',
          hint: 'بصيغة YYYY-MM-DD، ولا يسبق تاريخ البدء.',
          sample: '2026-10-01',
        },
      },
      tasks: {
        projectCode: {
          header: 'كود المشروع',
          hint: 'لازم يطابق كود مشروع موجود.',
          sample: 'PRJ-0001',
        },
        title: { header: 'عنوان المهمة', hint: '', sample: 'تصميم الشعار' },
        description: { header: 'الوصف', hint: 'اختياري.', sample: '' },
        categoryLabel: {
          header: 'التصنيف',
          hint: 'من قائمة التصنيفات المعرّفة بالإعدادات.',
          sample: '',
        },
        priority: {
          header: 'الأولوية',
          hint: 'اختياري، الافتراضي "متوسطة".',
          sample: 'متوسطة',
        },
        assigneeUsername: {
          header: 'اسم مستخدم المنفّذ',
          hint: 'اختياري. إن حُدِّد، تُسنَد المهمة له مباشرة.',
          sample: 'ahmed.hassan',
        },
        dueDate: {
          header: 'تاريخ الاستحقاق',
          hint: 'بصيغة YYYY-MM-DD.',
          sample: '2026-09-15',
        },
        estimatedHours: {
          header: 'الساعات المقدرة',
          hint: 'اختياري، الافتراضي صفر.',
          sample: '8',
        },
        taskValue: {
          header: 'قيمة المهمة',
          hint: 'اختياري — إن تُرك فارغا ووُجد منفّذ، تُملأ تلقائيا من سعر مهمته الافتراضي.',
          sample: '',
        },
      },
    },
  },

  /** Phase 10 — the manager and worker dashboards (phase brief §"Dashboards"). */
  dashboard: {
    welcomeBack: 'أهلا بعودتك،',
    manager: {
      overdueTasks: 'المهام المتأخرة',
      overdueTasksEmpty: 'لا توجد مهام متأخرة',
      projectsAtRisk: 'مشاريع في خطر',
      projectsAtRiskEmpty: 'لا توجد مشاريع في حالة حرجة',
      awaitingApproval: 'بانتظار الاعتماد',
      awaitingApprovalEmpty: 'لا توجد مهام بانتظار الاعتماد',
      workload: 'العبء الوظيفي',
      workloadEmpty: 'لا يوجد منفّذون نشطون',
      pendingPayouts: 'مستحقات هذه الدورة',
      pendingPayoutsEmpty: 'لا توجد دورة صرف مفتوحة',
      pendingAmount: 'المتبقي',
      monthDeductions: 'خصومات هذا الشهر',
      viewAll: 'عرض الكل',
    },
    worker: {
      activeTasks: 'مهامي النشطة',
      activeTasksEmpty: 'لا توجد مهام نشطة حاليا',
      dueNext: 'القادم استحقاقا',
      dueNextEmpty: 'لا توجد مواعيد قادمة',
      awaitingMySubmission: 'بانتظار تسليمي',
      awaitingReview: 'بانتظار المراجعة',
      performance: 'مؤشر أدائي',
      performanceHint: 'لا تؤثر الخصومات أو المكافآت على هذا المؤشر (SPEC §5.6).',
    },
  },

  /** Phase 10 — SPEC §5.6, shared by the worker dashboard widget and the report. */
  performance: {
    score: 'المؤشر العام',
    onTimeRate: 'الالتزام بالمواعيد',
    qualityScore: 'تقييم الجودة',
    volumeScore: 'حجم الإنجاز مقارنة بالزملاء',
    estimateAccuracy: 'دقة التقدير',
    taskCount: 'عدد المهام المكتملة',
    computedAt: 'آخر احتساب',
    noData: 'لا توجد مهام مكتملة بعد',
  },

  /** Phase 10 — utilisation = Σ estimatedHours of active tasks ÷ weeklyCapacityHours. */
  workload: {
    title: 'العبء الوظيفي',
    utilisation: 'نسبة الإشغال',
    activeHours: 'الساعات النشطة',
    capacity: 'الطاقة الأسبوعية',
    overCapacity: 'تجاوز الطاقة',
    overCapacityWarning: 'هذا المنفّذ يتجاوز طاقته الأسبوعية المتاحة حاليا.',
  },

  /** Phase 10 — the global deadlines calendar (phase brief item 6). */
  globalCalendar: {
    title: 'تقويم المواعيد',
    subtitle: 'كل مواعيد المهام والمشاريع، قابلة للتصفية حسب المشروع أو المنفّذ.',
    filterProject: 'المشروع',
    filterWorker: 'المنفّذ',
    allProjects: 'كل المشاريع',
    allWorkers: 'كل المنفّذين',
    empty: 'لا توجد مواعيد في هذا الشهر',
    types: {
      TASK: 'مهمة',
      PROJECT: 'مشروع',
      MILESTONE: 'مرحلة',
    },
  },

  /** Phase 8 — the per-user penalty formula (SPEC R2). */
  penaltyProfiles: {
    title: 'صيغ الخصم',
    subtitle: 'صيغة محفوظة تُسند لمن يختلف خصمهم عن الافتراضي العام.',
    create: 'صيغة خصم جديدة',
    edit: 'تعديل صيغة الخصم',
    name: 'اسم الصيغة',
    namePlaceholder: 'مثال: خصم المصممين',
    mode: 'طريقة الحساب',
    value: 'القيمة',
    valueCurrency: 'المبلغ بالجنيه',
    valuePercent: 'النسبة المئوية',
    graceHours: 'مهلة السماح (ساعة)',
    graceHoursHint: 'اتركه فارغا لاستخدام مهلة Virallap. تجاوز المشروع يظل الأعلى.',
    assignedUsers: 'المنفّذون المسندون',
    usersCount: '{count} منفّذ',
    delete: 'حذف الصيغة',
    deleteConfirm: 'سيعود كل منفّذ مسند لهذه الصيغة إلى الافتراضي العام.',
    created: 'أُنشئت صيغة الخصم',
    updated: 'حُدّثت صيغة الخصم',
    deleted: 'حُذفت صيغة الخصم',
    empty: 'لا توجد صيغ خصم مخصّصة',
    emptyHint: 'الجميع يخضع للافتراضي العام في الإعدادات.',
    noCap: 'لا يوجد حد أقصى للخصم. هذا قرار مقصود.',
    errors: {
      nameRequired: 'اسم الصيغة مطلوب',
      valueNegative: 'قيمة الخصم لا تكون سالبة',
      notFound: 'صيغة الخصم غير موجودة',
      duplicateName: 'يوجد صيغة خصم بنفس الاسم',
    },
  },

  audit: {
    title: 'سجل التدقيق',
    subtitle: 'سجل غير قابل للتعديل أو الحذف لكل ما يمسّ المال والصلاحيات والحالة.',
    actor: 'المنفِّذ',
    action: 'الإجراء',
    entity: 'العنصر',
    entityId: 'معرّف العنصر',
    date: 'التاريخ',
    dateFrom: 'من تاريخ',
    dateTo: 'إلى تاريخ',
    before: 'قبل',
    after: 'بعد',
    diff: 'الفرق',
    noChanges: 'لا يوجد تغيير مسجَّل',
    system: 'النظام',
    reason: 'السبب',
    ip: 'عنوان IP',
    empty: 'لا توجد سجلات مطابقة',
    added: 'أُضيف',
    removed: 'أُزيل',
    changed: 'تغيّر',
    viaImpersonation: 'نُفِّذ أثناء العرض كمستخدم آخر',
    allActors: 'كل المنفِّذين',
    allEntities: 'كل العناصر',
  },

  /** Audit action keys emitted in this phase, for rendering the log in Arabic. */
  auditActions: {
    'auth.signedIn': 'تسجيل دخول',
    'auth.signInFailed': 'محاولة دخول فاشلة',
    'auth.signedOut': 'تسجيل خروج',
    'auth.passwordChanged': 'تغيير كلمة المرور',
    'auth.throttled': 'إيقاف مؤقت بعد محاولات متكررة',
    'user.created': 'إنشاء مستخدم',
    'user.updated': 'تعديل مستخدم',
    'user.deactivated': 'تعطيل مستخدم',
    'user.activated': 'تفعيل مستخدم',
    'user.passwordReset': 'إعادة تعيين كلمة مرور',
    'user.rolesChanged': 'تعديل أدوار مستخدم',
    'role.created': 'إنشاء دور',
    'role.updated': 'تعديل دور',
    'role.deleted': 'حذف دور',
    'role.permissionsChanged': 'تعديل صلاحيات دور',
    'impersonation.started': 'بدء العرض كمستخدم آخر',
    'impersonation.stopped': 'إنهاء العرض كمستخدم آخر',
    'setting.updated': 'تعديل إعداد',
    'client.created': 'إنشاء عميل',
    'client.updated': 'تعديل عميل',
    'client.deleted': 'حذف عميل',
    'project.created': 'إنشاء مشروع',
    'project.updated': 'تعديل مشروع',
    'project.deleted': 'حذف مشروع',
    'project.membersChanged': 'تعديل أعضاء المشروع',
    'project.healthOverrideSet': 'ضبط صحة المشروع يدويا',
    'project.healthOverrideCleared': 'إلغاء التقدير اليدوي لصحة المشروع',
    'project.createdFromTemplate': 'إنشاء مشروع من قالب',
    'milestone.created': 'إضافة مرحلة',
    'milestone.updated': 'تعديل مرحلة',
    'milestone.deleted': 'حذف مرحلة',
    'milestone.reordered': 'إعادة ترتيب المراحل',
    'projectTemplate.created': 'حفظ قالب مشروع',
    'task.created': 'إنشاء مهمة',
    'task.updated': 'تعديل مهمة',
    'task.deleted': 'حذف مهمة',
    'task.assigned': 'إسناد مهمة',
    'task.reassigned': 'تغيير منفّذ مهمة',
    'task.statusChanged': 'تغيير حالة مهمة',
    'task.approved': 'اعتماد مهمة',
    'task.revisionRequested': 'طلب تعديل على مهمة',
    'task.cancelled': 'إلغاء مهمة',
    'task.watcherAdded': 'إضافة متابع لمهمة',
    'task.watcherRemoved': 'إزالة متابع من مهمة',
    'task.dependencyAdded': 'إضافة اعتمادية لمهمة',
    'task.dependencyRemoved': 'إزالة اعتمادية من مهمة',
    'task.commented': 'تعليق على مهمة',
    'task.partialPaymentIntent': 'مستحق جزئي لمنفّذ سابق',
    'task.assignedDuringLeave': 'إسناد مهمة خلال إجازة معتمدة',
    'task.escalated': 'تصعيد مهمة متأخرة',
    'task.dueDateExtended': 'تمديد موعد تسليم مهمة',
    'holiday.created': 'إضافة عطلة رسمية',
    'holiday.updated': 'تعديل عطلة رسمية',
    'holiday.deleted': 'حذف عطلة رسمية',
    'holiday.imported': 'استيراد عطلات رسمية',
    'leave.requested': 'طلب إجازة',
    'leave.recorded': 'تسجيل إجازة',
    'leave.approved': 'اعتماد إجازة',
    'leave.rejected': 'رفض إجازة',
    'extension.requested': 'طلب تمديد',
    'extension.approved': 'اعتماد تمديد',
    'extension.rejected': 'رفض تمديد',
    'extension.penaltyRecomputeRequested': 'إعادة احتساب خصم بعد تمديد',
    'ledger.entryCreated': 'قيد مالي جديد',
    'ledger.reversed': 'عكس قيد مالي',
    'ledger.adjustment': 'تسوية مالية',
    'ledger.earningSkipped': 'اعتماد بلا استحقاق',
    'ledger.reversalBlocked': 'تعذّر عكس قيد من دورة مصروفة',
    'advance.created': 'تسجيل سلفة',
    'bonus.created': 'إضافة مكافأة',
    'penalty.applied': 'تطبيق خصم تأخير',
    'penalty.recalculated': 'إعادة احتساب خصم تأخير',
    'penalty.cleared': 'إلغاء خصم تأخير بالكامل',
    'penalty.skipped': 'تخطّي احتساب خصم',
    'penalty.created': 'تسجيل خصم يدوي',
    'penalty.reversed': 'عكس خصم',
    'bonus.reversed': 'عكس مكافأة',
    'penaltyProfile.created': 'إنشاء صيغة خصم',
    'penaltyProfile.updated': 'تعديل صيغة خصم',
    'penaltyProfile.deleted': 'حذف صيغة خصم',
    'penaltyProfile.assigned': 'إسناد صيغة خصم لمنفّذ',
    'payout.cycleClosed': 'إغلاق دورة صرف',
    'payout.cycleSettled': 'اكتمال صرف دورة',
    'payout.drafted': 'توليد مستحق مسودة',
    'payout.approved': 'اعتماد مستحق',
    'payout.paid': 'صرف مستحق',
    'payout.partiallyPaid': 'صرف جزئي لمستحق',
    'payout.salarySkipped': 'تخطّي راتب بلا قيمة مسجّلة',
    'payout.skippedDeletedUser': 'رصيد لمستخدم محذوف لم يُصرف',
  },

  impersonation: {
    start: 'عرض كـ',
    stop: 'إنهاء العرض',
    /** `{name}` is substituted at render time. */
    banner: 'أنت تعرض النظام بحساب {name}',
    bannerHint: 'كل إجراء تنفّذه الآن يُسجَّل باسمك واسم الحساب المعروض معا.',
    notAllowed: 'العرض كمستخدم آخر متاح لمدير النظام فقط',
    cannotImpersonateSelf: 'لا يمكنك العرض بحسابك الشخصي',
    cannotImpersonateInactive: 'لا يمكن العرض بحساب معطّل',
    alreadyImpersonating: 'أنهِ العرض الحالي قبل بدء عرض آخر',
    started: 'بدأ العرض كمستخدم آخر',
    stopped: 'انتهى العرض كمستخدم آخر',
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
    'task.work.assigned': 'بدء وتسليم وإيقاف مهامه المسنَدة إليه',
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

  settings: {
    title: 'الإعدادات',
    subtitle:
      'كل رقم تحكمه قاعدة عمل في مكان واحد — يُطبَّق فور الحفظ ويُسجَّل في سجل التدقيق.',
    save: 'حفظ التغييرات',
    saved: 'تم حفظ الإعدادات',
    saveFailed: 'تعذّر حفظ الإعدادات',
    discard: 'تراجع عن التغييرات',
    /** `{count}` is substituted at render time. */
    unsavedChanges: '{count} تغيير غير محفوظ',
    noChanges: 'لا توجد تغييرات',
    readOnly: 'لديك صلاحية الاطّلاع على الإعدادات دون تعديلها.',
    isDefault: 'القيمة الافتراضية',
    restoreDefault: 'استعادة الافتراضي',
    invalidValue: 'قيمة غير صالحة',
    sections: 'الأقسام',
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
      security: 'الأمان وتسجيل الدخول',
      holidays: 'العطلات الرسمية',
    },
    groupHints: {
      penalty:
        'الطريقة الافتراضية لاحتساب الخصم ومهلة السماح. تُطبَّق على كل منفّذ ليس له ملف خصم خاص.',
      calendar:
        'أيام العطلة الأسبوعية وساعات العمل وعدد أيام العمل في الشهر — الأساس اللي يُقاس عليه كل تأخير.',
      payout: 'يوم إغلاق دورة الصرف وطرق الصرف المتاحة.',
      performance:
        'أوزان مؤشر الأداء. تُنسَب إلى مجموعها الفعلي، فلا يلزم أن يكون 100 بالضبط.',
      health: 'حدود تحوّل حالة المشروع إلى تحذير أو خطر.',
      notifications: 'مواعيد التصعيد والتذكير وفترة تحديث الإشعارات.',
      tasks: 'تصنيفات المهام. المعرّف ثابت والاسم قابل للتعديل.',
      projects: 'أنواع التعاقد المتاحة عند إنشاء مشروع.',
      labels: 'الأسماء العربية للحالات والأولويات. القيم البرمجية ثابتة ولا تتغيّر.',
      whatsapp: 'نص رسائل واتساب الجاهزة. المتغيّرات بين قوسين معقوفين تُستبدل تلقائيا.',
      security:
        'حدود محاولات الدخول وطول كلمة المرور — قابلة للتشديد أو التخفيف دون إعادة نشر.',
      holidays: 'الأيام اللي لا يُحتسب فيها تأخير ولا وقت عمل.',
    },
    /** The taxonomy / list editors. */
    list: {
      addItem: 'إضافة عنصر',
      itemId: 'المعرّف',
      itemLabel: 'الاسم بالعربية',
      idHint: 'حروف لاتينية صغيرة وأرقام وشرطات فقط. ثابت بعد الحفظ.',
      idLocked: 'معرّف مستخدَم في سجلات قائمة — لا يمكن تغييره.',
      atLeastOne: 'يجب إبقاء عنصر واحد على الأقل',
      duplicateId: 'المعرّف مكرر',
      empty: 'لا توجد عناصر',
    },
    weights: {
      total: 'مجموع الأوزان',
      /**
       * Advisory, not a validation error: `computePerformanceScore` divides by
       * the actual sum, so 90 or 110 still yields a score inside 0–100. Saying
       * "must" here would contradict the engine.
       */
      notHundred: 'المجموع لا يساوي 100 — تُنسَب الأوزان إلى مجموعها الفعلي.',
    },
    templates: {
      variablesHint: 'المتغيّرات المتاحة: {list}',
    },
    keys: {
      'security.maxLoginAttempts': 'عدد محاولات الدخول قبل الإيقاف المؤقت',
      'security.loginWindowMinutes': 'مدة احتساب المحاولات (بالدقائق)',
      'security.lockoutMinutes': 'مدة الإيقاف المؤقت (بالدقائق)',
      'security.minPasswordLength': 'الحد الأدنى لطول كلمة المرور',
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
      'notifications.dueSoonHours': 'التذكير قبل الموعد النهائي (بالساعات)',
      'tasks.categories': 'تصنيفات المهام',
      'tasks.dueSoonDays': 'مدى "مستحقة قريبا" (بالأيام)',
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
      ON_HOLD: 'متوقف مؤقتا',
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
    /** SPEC §4 `Payout.status` / `PayoutCycle.status` (Phase 7). */
    payoutStatus: {
      DRAFT: 'مسودة',
      APPROVED: 'معتمد',
      PAID: 'مصروف',
    },
    payoutCycleStatus: {
      OPEN: 'مفتوحة',
      CLOSED: 'مغلقة',
      PAID: 'مصروفة',
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
    /** Phase 3 addition — not a SPEC §4 enum. See docs/DECISIONS.md. */
    milestoneStatus: {
      PENDING: 'لم تبدأ',
      IN_PROGRESS: 'قيد التنفيذ',
      DONE: 'مكتملة',
      DELAYED: 'متأخرة',
    },
    /**
     * Phase 3 addition — not a SPEC §4 enum. Deliberately distinct wording from
     * "منفّذ" (the fixed CLAUDE.md term for a task assignee): this is a
     * project-team role, not the worker/assignee relationship.
     */
    projectMemberRole: {
      MANAGER: 'مشرف',
      CONTRIBUTOR: 'مساهم',
      VIEWER: 'مشاهد',
    },
    /** SPEC §4 enum — who a delay is attributed to, for reporting only. */
    delayAttribution: {
      WORKER: 'المنفّذ',
      CLIENT: 'العميل',
      INTERNAL: 'داخلي',
      DEPENDENCY: 'اعتمادية',
    },
    /**
     * Phase 4 addition — not a SPEC §4 enum. The vocabulary of the task
     * activity feed. See docs/DECISIONS.md.
     */
    taskActivityType: {
      CREATED: 'أُنشئت المهمة',
      STATUS_CHANGED: 'تغيّرت الحالة',
      ASSIGNED: 'تغيّر المنفّذ',
      WATCHER_ADDED: 'أُضيف متابع',
      WATCHER_REMOVED: 'أُزيل متابع',
      COMMENTED: 'تعليق جديد',
      DUE_DATE_CHANGED: 'تغيّر موعد التسليم',
      VALUE_CHANGED: 'تغيّرت قيمة المهمة',
      UPDATED: 'تعديل بيانات المهمة',
      DEPENDENCY_ADDED: 'أُضيفت اعتمادية',
      DEPENDENCY_REMOVED: 'أُزيلت اعتمادية',
      ELAPSED_RECOMPUTED: 'أُعيد احتساب زمن العمل',
    },
  },

  /** Default seed values for Settings entries that hold Arabic content. */
  defaults: {
    /**
     * Leave types carry a stable id for the same reason categories do
     * (`Leave.typeId`, Phase 6) — renaming "إجازة طارئة" must not re-type
     * every leave ever recorded under it.
     */
    leaveTypes: [
      { id: 'annual', label: 'إجازة سنوية' },
      { id: 'sick', label: 'إجازة مرضية' },
      { id: 'emergency', label: 'إجازة طارئة' },
      { id: 'unpaid', label: 'إجازة بدون أجر' },
    ],
    /**
     * Categories carry a stable id plus an editable Arabic label, so renaming
     * one in Settings never orphans the tasks that reference it
     * (`Task.categoryId`). See docs/DECISIONS.md (Phase 4).
     */
    taskCategories: [
      { id: 'design', label: 'تصميم' },
      { id: 'development', label: 'تطوير' },
      { id: 'content', label: 'محتوى' },
      { id: 'marketing', label: 'تسويق' },
      { id: 'video', label: 'مونتاج' },
      { id: 'management', label: 'إدارة' },
    ],
    paymentMethods: ['إنستاباي', 'فودافون كاش', 'تحويل بنكي', 'نقدا'],
    whatsappTemplates: {
      taskAssigned:
        'السلام عليكم {name}، تم إسناد مهمة "{task}" إليك، موعد التسليم {due}.',
      taskOverdue: 'تذكير: مهمة "{task}" تجاوزت موعد التسليم {due}.',
      payoutPaid: 'تم صرف مستحقاتك بمبلغ {amount}.',
      penaltyApplied: 'تنبيه: تم خصم {amount} من مستحقاتك بخصوص مهمة "{task}".',
    },
  },

  /** The app shell: sidebar, header, and the controls that live in them. */
  shell: {
    navigation: 'التنقل',
    toggleSidebar: 'طيّ القائمة الجانبية أو توسيعها',
    expandSidebar: 'توسيع القائمة الجانبية',
    collapseSidebar: 'طيّ القائمة الجانبية',
    notifications: 'الإشعارات',
    notificationsEmpty: 'لا توجد إشعارات',
    notificationsHint: 'ستظهر هنا إشعارات المهام والمستحقات.',
    /** `{count}` is substituted at render time. */
    unreadCount: '{count} غير مقروء',
    userMenu: 'قائمة الحساب',
    account: 'الحساب',
    appearance: 'المظهر والعرض',
    openCommandPalette: 'فتح لوحة الأوامر',
    commandShortcut: 'Ctrl + K',
    breadcrumb: 'مسار التنقل',
    pageActions: 'إجراءات الصفحة',
  },

  /** The Ctrl+K palette. */
  command: {
    title: 'لوحة الأوامر',
    placeholder: 'ابحث عن صفحة أو مستخدم أو دور…',
    empty: 'لا توجد نتائج',
    emptyHint: 'جرّب اسما أو كلمة أقصر.',
    searching: 'جاري البحث…',
    groups: {
      navigation: 'التنقل',
      actions: 'إجراءات سريعة',
      users: 'المستخدمون',
      roles: 'الأدوار',
      appearance: 'المظهر والعرض',
    },
    hints: {
      navigate: 'للتنقل',
      select: 'للفتح',
      close: 'للإغلاق',
    },
  },

  /** DataTable chrome. */
  table: {
    columns: 'الأعمدة',
    columnsHint: 'اختر الأعمدة الظاهرة',
    filters: 'التصفية',
    clearFilters: 'مسح التصفية',
    /** `{count}` is substituted at render time. */
    activeFilters: '{count} تصفية نشطة',
    sortAscending: 'ترتيب تصاعدي',
    sortDescending: 'ترتيب تنازلي',
    sortClear: 'إلغاء الترتيب',
    rowsPerPage: 'صفوف لكل صفحة',
    /** `{from}`, `{to}` and `{total}` are substituted at render time. */
    range: 'عرض {from}–{to} من {total}',
    /** `{page}` and `{pages}` are substituted at render time. */
    pageOf: 'صفحة {page} من {pages}',
    firstPage: 'الصفحة الأولى',
    lastPage: 'الصفحة الأخيرة',
    nextPage: 'الصفحة التالية',
    previousPage: 'الصفحة السابقة',
    empty: 'لا توجد صفوف',
    emptyFiltered: 'لا توجد صفوف مطابقة للتصفية',
    savedViews: 'العروض المحفوظة',
    saveView: 'حفظ العرض الحالي',
    saveViewHint: 'يحفظ التصفية والترتيب والأعمدة الظاهرة.',
    viewName: 'اسم العرض',
    deleteView: 'حذف العرض',
    defaultView: 'العرض الافتراضي',
    /** `{count}` is substituted at render time. */
    selectedCount: 'تم تحديد {count}',
  },

  /** Destructive confirmation: the user types the name back (SPEC §9). */
  confirm: {
    title: 'تأكيد الإجراء',
    irreversible: 'هذا الإجراء لا يمكن التراجع عنه.',
    /** `{value}` is the exact text the user must type. */
    typeToConfirm: 'اكتب «{value}» للتأكيد',
    mismatch: 'النص غير مطابق',
    proceed: 'نفّذ',
  },

  /** Toast conventions: one line, one fact, optionally one action. */
  toast: {
    dismiss: 'إخفاء الإشعار',
    region: 'إشعارات النظام',
  },

  /** Project health (SPEC §5.7). */
  health: {
    GREEN: 'سليم',
    AMBER: 'يحتاج متابعة',
    RED: 'متعثّر',
    override: 'تقدير يدوي',
  },

  whatsapp: {
    open: 'مراسلة عبر واتساب',
    /** `{name}` is substituted at render time. */
    openWith: 'مراسلة {name} عبر واتساب',
    noPhone: 'لا يوجد رقم موبايل مسجّل',
    /** Editable in Settings — these name each template, not its content. */
    templateNames: {
      taskAssigned: 'إسناد مهمة',
      taskOverdue: 'تأخّر مهمة',
      payoutPaid: 'صرف مستحقات',
      penaltyApplied: 'تطبيق خصم',
    },
    /** The four `{placeholder}` tokens `lib/whatsapp` substitutes. */
    variables: {
      name: 'اسم المنفّذ',
      task: 'عنوان المهمة',
      due: 'موعد التسليم',
      amount: 'المبلغ',
    },
  },

  /**
   * Notifications (SPEC §8, Phase 9) — the bell's drawer, the preferences
   * page, and the Arabic prose composed onto every `Notification` row at the
   * moment it is delivered (`modules/notification/messages.ts`).
   */
  notifications: {
    title: 'الإشعارات',
    empty: 'لا توجد إشعارات',
    emptyHint: 'ستظهر هنا إشعارات المهام والمستحقات.',
    markAllRead: 'تعليم الكل كمقروء',
    markRead: 'تعليم كمقروء',
    /** `{count}` is substituted at render time. */
    unreadCount: '{count} غير مقروء',
    viewAll: 'عرض كل الإشعارات',
    preferencesLink: 'إعدادات الإشعارات',
    nonDismissable: 'لا يمكن إخفاء هذا الإشعار',

    /** Drawer/list group labels, by notification type. */
    types: {
      TASK_ASSIGNED: 'إسناد مهمة',
      TASK_DUE_SOON: 'اقتراب موعد التسليم',
      TASK_OVERDUE: 'تجاوز موعد التسليم',
      TASK_SUBMITTED: 'تسليم مهمة',
      TASK_REVISION_REQUESTED: 'طلب تعديل',
      TASK_APPROVED: 'اعتماد مهمة',
      TASK_ESCALATED: 'تصعيد مهمة',
      TASK_MENTIONED: 'إشارة في تعليق',
      PENALTY_APPLIED: 'خصم',
      BONUS_GRANTED: 'مكافأة',
      MONEY_REVERSED: 'إلغاء حركة مالية',
      PAYOUT_APPROVED: 'اعتماد مستحقات',
      PAYOUT_PAID: 'صرف مستحقات',
      EXTENSION_REQUESTED: 'طلب تمديد',
      EXTENSION_DECIDED: 'قرار تمديد',
      MANAGER_DIGEST: 'ملخص يومي',
    },

    /**
     * Title/body pairs, composed once per delivery. `{placeholders}` are
     * filled from the event payload — never assembled by string
     * concatenation, so the wording stays in one file (CLAUDE.md: "no Arabic
     * string literals in JSX").
     */
    messages: {
      taskAssigned: {
        title: 'تم إسناد مهمة إليك',
        body: 'أُسندت إليك مهمة "{task}"، موعد التسليم {due}.',
      },
      taskDueSoon: {
        title: 'اقتراب موعد التسليم',
        body: 'مهمة "{task}" مطلوب تسليمها بحلول {due}.',
      },
      taskOverdue: {
        title: 'مهمة متأخرة',
        body: 'مهمة "{task}" تجاوزت موعد التسليم {due}.',
      },
      taskSubmitted: {
        title: 'تم تسليم مهمة',
        body: 'سلّم {name} مهمة "{task}" وهي بانتظار المراجعة.',
      },
      taskRevisionRequested: {
        title: 'طُلب تعديل على مهمتك',
        body: 'طُلب تعديل على مهمة "{task}"، الموعد الجديد {due}: {reason}',
      },
      taskApproved: {
        title: 'تم اعتماد مهمتك',
        body: 'تم اعتماد مهمة "{task}".',
      },
      taskEscalatedPm: {
        title: 'مهمة تحتاج متابعة',
        body: 'مهمة "{task}" تجاوزت {days} يوم عمل تأخيرا وتحتاج متابعتك.',
      },
      taskEscalatedAdmin: {
        title: 'مهمة متعثّرة',
        body: 'مهمة "{task}" تجاوزت {days} يوم عمل تأخيرا وصُعّدت للإدارة.',
      },
      taskMentioned: {
        title: 'أشار إليك {name}',
        body: 'أشار إليك {name} في تعليق على مهمة "{task}".',
      },
      penaltyApplied: {
        title: 'تم خصم مبلغ من مستحقاتك',
        body: 'خُصم {amount} بخصوص مهمة "{task}": {formula}',
      },
      penaltyAppliedManual: {
        title: 'تم خصم مبلغ من مستحقاتك',
        body: 'خُصم {amount} من مستحقاتك.',
      },
      bonusGranted: {
        title: 'حصلت على مكافأة',
        body: 'مُنحت مكافأة بقيمة {amount}: {reason}',
      },
      moneyReversed: {
        title: 'تم إلغاء حركة مالية',
        body: 'أُلغيت حركة بقيمة {amount}: {reason}',
      },
      payoutApproved: {
        title: 'تم اعتماد مستحقاتك',
        body: 'اعتُمدت مستحقات بقيمة {amount}.',
      },
      payoutPaid: {
        title: 'تم صرف مستحقاتك',
        body: 'صُرف مبلغ {amount} من مستحقاتك.',
      },
      extensionRequested: {
        title: 'طلب تمديد جديد',
        body: 'طلب {name} تمديد موعد مهمة "{task}" إلى {due}.',
      },
      extensionApproved: {
        title: 'تم اعتماد طلب التمديد',
        body: 'اعتُمد تمديد مهمة "{task}" إلى {due}.',
      },
      extensionRejected: {
        title: 'تم رفض طلب التمديد',
        body: 'رُفض طلب تمديد مهمة "{task}".',
      },
      managerDigest: {
        title: 'الملخص اليومي',
        body: '{overdue} مهمة متأخرة، {awaiting} بانتظار الاعتماد، {atRisk} مشروع متعثر.',
      },
    },

    /** The `/notifications/preferences` page. */
    preferences: {
      title: 'إعدادات الإشعارات',
      subtitle: 'اختر الإشعارات اللي تريد استقبالها داخل النظام.',
      mandatory: 'إلزامي',
      mandatoryHint: 'لا يمكن إيقاف هذا الإشعار — يخص إسناد أو تأخر مهامك مباشرة.',
      enabled: 'مفعّل',
      disabled: 'موقوف',
      saved: 'تم حفظ الإعدادات',
    },

    errors: {
      mandatoryType: 'لا يمكن إيقاف هذا النوع من الإشعارات',
      notFound: 'الإشعار غير موجود',
    },
  },

  /** The dev-only /design-system route. Not part of the product surface. */
  designSystem: {
    title: 'نظام التصميم',
    subtitle: 'كل مكوّن في المظهرين وفي الكثافتين، بمحتوى عربي حقيقي.',
    devOnly: 'هذه الصفحة متاحة في بيئة التطوير فقط.',
    sections: {
      surfaces: 'الأسطح',
      accent: 'اللون الأساسي',
      data: 'ألوان البيانات',
      typography: 'الخطوط والأرقام',
      status: 'حالات المهام',
      projectStatus: 'حالات المشاريع',
      priority: 'الأولويات',
      health: 'صحة المشاريع',
      ledger: 'أنواع الحركات المالية',
      people: 'الأشخاص',
      money: 'المبالغ',
      dates: 'التواريخ',
      buttons: 'الأزرار',
      forms: 'حقول النماذج',
      table: 'الجداول',
      sheet: 'اللوحات الجانبية',
      dialogs: 'الحوارات',
      feedback: 'الرسائل والحالات',
      skeletons: 'هياكل التحميل',
    },
    labels: {
      hue: 'اللون',
      token: 'المتغيّر',
      contrast: 'نسبة التباين',
      sample: 'نموذج',
      openSheet: 'افتح لوحة جانبية',
      openEntitySheet: 'افتح لوحة مهمة',
      openConfirm: 'افتح حوار تأكيد',
      showToast: 'أظهر رسالة نجاح',
      showErrorToast: 'أظهر رسالة خطأ',
      density: 'الكثافة',
      theme: 'المظهر',
      both: 'الاثنان',
      surfaceSunken: 'سطح غائر',
      surfaceBase: 'سطح الصفحة',
      surfaceRaised: 'سطح بارز',
      surfaceInset: 'سطح داخلي',
      surfaceOverlay: 'سطح طافٍ',
      surfaceField: 'خلفية الحقل',
      surfaceHover: 'تمرير المؤشر',
      surfaceSelected: 'صف مُحدَّد',
      surfaceScrim: 'حجاب النوافذ',
    },
    /**
     * Sample content for the gallery. Real Arabic, real names, real lengths —
     * a design system reviewed with `Lorem ipsum` is a design system reviewed
     * in the wrong language and the wrong text direction.
     */
    samples: {
      people: [
        {
          fullName: 'أحمد محمود عبد الله',
          username: 'ahmed.mahmoud',
          phone: '+201012345678',
        },
        {
          fullName: 'فاطمة الزهراء حسن',
          username: 'fatma.hassan',
          phone: '+201115556677',
        },
        { fullName: 'يحيى إبراهيم', username: 'yehia.ibrahim', phone: '+201234567890' },
        { fullName: 'منى عبد الرحمن', username: 'mona.abdelrahman', phone: '' },
      ],
      projects: [
        { code: 'ACME-01', name: 'هوية بصرية لشركة النخبة' },
        { code: 'RETL-07', name: 'متجر إلكتروني — المرحلة الثانية' },
        { code: 'CNTN-12', name: 'محتوى شهري للسوشيال ميديا' },
      ],
      tasks: [
        'تصميم صفحة الهبوط',
        'مراجعة نصوص الحملة الإعلانية',
        'مونتاج الفيديو التعريفي',
        'تسليم ملفات الهوية النهائية',
        'إعداد تقرير الأداء الشهري',
      ],
      sheetTitle: 'تصميم صفحة الهبوط',
      sheetSubtitle: 'هوية بصرية لشركة النخبة · تسليم خلال 3 أيام',
      sheetTabs: { details: 'التفاصيل', comments: 'التعليقات', activity: 'السجل' },
      sheetBody:
        'كل عنصر في هذا النظام يُفتح في لوحة جانبية فوق الصفحة، لا بالانتقال إلى صفحة أخرى.',
      confirmTitle: 'حذف المشروع',
      confirmDescription:
        'سيُخفى المشروع وكل مهامه من كل الشاشات. القيود المالية تبقى كما هي.',
      toastSaved: 'تم حفظ التعديلات',
      toastFailed: 'تعذّر عكس الخصم',
      toastFailedDetail: 'راجع صلاحياتك ثم حاول مرة أخرى.',
      emptyTitle: 'لا توجد مهام في هذا المشروع',
      emptyDescription: 'أنشئ أول مهمة وأسندها إلى منفّذ لتبدأ متابعة التسليم.',
      emptyAction: 'مهمة جديدة',
      formLabel: 'قيمة المهمة',
      formHint: 'المبلغ اللي يستحقه المنفّذ عند اعتماد التسليم.',
      formError: 'المبلغ بالأرقام فقط، بحد أقصى خانتان عشريتان',
      columnTask: 'المهمة',
      columnProject: 'المشروع',
      columnAssignee: 'المنفّذ',
      columnStatus: 'الحالة',
      columnPriority: 'الأولوية',
      columnValue: 'القيمة',
      columnDue: 'التسليم',
      paragraph:
        'نظام تشغيل داخلي لوكالة رقمية: مشاريع ومهام ومنفّذون ومواعيد تسليم وخصومات ومكافآت ومستحقات، محسوبة بالنظام لا بالاجتهاد.',
    },
  },

  a11y: {
    skipToContent: 'تخطَّ إلى المحتوى',
    toggleTheme: 'تبديل المظهر',
    openMenu: 'فتح القائمة',
    loading: 'جاري التحميل',
    /** Announced when a list of results changes under the search box. */
    resultsUpdated: 'تم تحديث النتائج',
  },
} as const

export type ArabicStrings = typeof ar

/** Convenience for the layout and metadata. */
export const LOCALE = 'ar-EG'
export const DIRECTION = 'rtl'
