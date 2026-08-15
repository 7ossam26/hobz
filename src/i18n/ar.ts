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
      day: { one: 'يوم', two: 'يومين', few: '{n} أيام', many: '{n} يومًا' },
      week: { one: 'أسبوع', two: 'أسبوعين', few: '{n} أسابيع', many: '{n} أسبوعًا' },
      month: { one: 'شهر', two: 'شهرين', few: '{n} أشهر', many: '{n} شهرًا' },
      year: { one: 'سنة', two: 'سنتين', few: '{n} سنوات', many: '{n} سنة' },
    },
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
    signingIn: 'جارٍ تسجيل الدخول…',
    welcome: 'أهلًا بك',
    signInHint: 'ادخل باسم المستخدم وكلمة المرور اللذين زوّدك بهما مدير النظام.',
    /** No self-signup and no self-service reset (SPEC §2). Say so plainly. */
    noSelfSignup: 'لا يوجد تسجيل ذاتي. الحسابات يُنشئها مدير النظام فقط.',
    forgotPassword: 'نسيت كلمة المرور؟ تواصل مع مدير النظام لإعادة تعيينها.',
    /** `{minutes}` is substituted at render time. */
    lockedForMinutes: 'الحساب موقوف مؤقتًا. حاول بعد {minutes} دقيقة.',
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
    usernameLength: 'اسم المستخدم بين ٣ و٣٢ خانة',
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
    capacityRange: 'ساعات الطاقة الأسبوعية بين ١ و١٦٨',
    roleNameArRequired: 'اسم الدور بالعربية مطلوب',
    roleNameEnFormat: 'المعرّف الإنجليزي بحروف لاتينية كبيرة وشرطة سفلية فقط',
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
    isWorkerHint: 'يستلم مهامًا وتُحتسب له مستحقات. مستقل تمامًا عن الدور.',
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
      'لا يمكن تعطيل هذا الحساب: لديه مهام مفتوحة يجب إعادة إسنادها أو إغلاقها أولًا.',
    openTasksLabel: 'المهام المفتوحة',
    cannotDeactivateSelf: 'لا يمكنك تعطيل حسابك الشخصي',
    cannotDeactivateLastSuperAdmin: 'لا يمكن تعطيل آخر مدير نظام',
    superAdminRoleRestricted: 'منح دور مدير النظام أو نزعه متاح لمدير النظام وحده',
  },

  roles: {
    superAdmin: 'مدير النظام',
    superAdminDescription:
      'دور النظام الأعلى. يملك كل الصلاحيات ضمنيًا ولا يمكن تعديله أو حذفه.',
    title: 'الأدوار',
    create: 'دور جديد',
    edit: 'تعديل الدور',
    delete: 'حذف الدور',
    nameAr: 'اسم الدور بالعربية',
    nameEn: 'المعرّف الإنجليزي',
    nameEnHint: 'معرّف ثابت يُستخدم في الكود والسجلات. حروف لاتينية كبيرة وشرطة سفلية.',
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
    superAdminImplicit: 'يملك كل الصلاحيات ضمنيًا، بما فيها الصلاحيات التي تُضاف لاحقًا',
    inUse: 'لا يمكن حذف دور مسنَد إلى مستخدمين. أزل الدور عنهم أولًا.',
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
    codeHint: 'يُنشأ تلقائيًا، ويمكن تعديله.',
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
      description: 'إدارة المهام والإسناد والتسليم ستُضاف لاحقًا لهذا المشروع.',
    },
    health: {
      title: 'صحة المشروع',
      computed: 'المحتسب تلقائيًا',
      overrideBadge: 'تقدير يدوي',
      overrideAction: 'ضبط الحالة يدويًا',
      clearOverride: 'العودة للاحتساب التلقائي',
      overrideReasonRequired: 'سبب التقدير اليدوي مطلوب',
      overrideSet: 'تم ضبط صحة المشروع يدويًا',
      overrideCleared: 'عاد المشروع للاحتساب التلقائي',
      setOverrideTitle: 'ضبط صحة المشروع يدويًا',
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
      selectUser: 'اختر مستخدمًا',
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
      deleteDescription: 'سيُحذف هذا العنصر من الجدول الزمني للمشروع نهائيًا.',
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
      selectTemplate: 'اختر قالبًا',
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
    taskValueHint: 'تُملأ تلقائيًا من أجر المهمة الافتراضي للمنفّذ، ويمكن تعديلها.',
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
      ratingLabel: 'تقييم الجودة (١–٥)',
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
        'يمكنك المتابعة رغم ذلك — الاعتماديات تنبيه وليست قيدًا على البدء.',
      warningDismiss: 'متابعة على أي حال',
    },

    comments: {
      title: 'التعليقات',
      placeholder: 'اكتب تعليقًا… استخدم @ لذكر زميل',
      submit: 'إضافة تعليق',
      empty: 'لا توجد تعليقات بعد',
      added: 'تمت إضافة التعليق',
      mentionHint: 'اكتب @ ثم اسم المستخدم',
    },

    activity: {
      title: 'سجل المهمة',
      empty: 'لا توجد حركات مسجَّلة',
      system: 'النظام',
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
    searchPlaceholder: 'ابحث في عناوين المهام…',

    facets: {
      project: 'المشروع',
      assignee: 'المنفّذ',
      status: 'الحالة',
      priority: 'الأولوية',
      category: 'التصنيف',
      overdueOnly: 'المتأخرة فقط',
      dueThisWeek: 'مستحقة هذا الأسبوع',
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
      },
    },

    watcherPicker: {
      title: 'إضافة متابع',
      placeholder: 'اختر مستخدمًا',
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
      sameAssigneeAsWatcher: 'منفّذ المهمة متابع لها تلقائيًا',
      selfDependency: 'لا يمكن أن تعتمد المهمة على نفسها',
      reciprocalDependency: 'المهمتان لا يمكن أن تعتمد كل منهما على الأخرى',
      duplicateDependency: 'هذه الاعتمادية مضافة بالفعل',
      ratingRange: 'تقييم الجودة بين ١ و٥',
      ratingRequired: 'تقييم الجودة مطلوب عند الاعتماد',
      notBlocked: 'المهمة ليست معلَّقة',
      noPreviousStatus: 'لا توجد حالة سابقة لاستئناف المهمة إليها',
      partialAmountRequiresPreviousAssignee: 'لا يوجد منفّذ سابق لصرف مستحق له',
      partialAmountInvalid: 'المبلغ الجزئي يجب أن يكون أكبر من صفر',
      partialAmountTooLarge: 'المبلغ الجزئي يتجاوز قيمة المهمة',
      commentEmpty: 'التعليق فارغ',
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
    'project.healthOverrideSet': 'ضبط صحة المشروع يدويًا',
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
  },

  impersonation: {
    start: 'عرض كـ',
    stop: 'إنهاء العرض',
    /** `{name}` is substituted at render time. */
    banner: 'أنت تعرض النظام بحساب {name}',
    bannerHint: 'كل إجراء تنفّذه الآن يُسجَّل باسمك واسم الحساب المعروض معًا.',
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
    leaveTypes: ['إجازة سنوية', 'إجازة مرضية', 'إجازة طارئة', 'إجازة بدون أجر'],
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
    paymentMethods: ['إنستاباي', 'فودافون كاش', 'تحويل بنكي', 'نقدًا'],
    whatsappTemplates: {
      taskAssigned:
        'السلام عليكم {name}، تم إسناد مهمة "{task}" إليك، موعد التسليم {due}.',
      taskOverdue: 'تذكير: مهمة "{task}" تجاوزت موعد التسليم {due}.',
      payoutPaid: 'تم صرف مستحقاتك بمبلغ {amount}.',
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
    emptyHint: 'جرّب اسمًا أو كلمة أقصر.',
    searching: 'جارٍ البحث…',
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
      formHint: 'المبلغ الذي يستحقه المنفّذ عند اعتماد التسليم.',
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
    loading: 'جارٍ التحميل',
    /** Announced when a list of results changes under the search box. */
    resultsUpdated: 'تم تحديث النتائج',
  },
} as const

export type ArabicStrings = typeof ar

/** Convenience for the layout and metadata. */
export const LOCALE = 'ar-EG'
export const DIRECTION = 'rtl'
