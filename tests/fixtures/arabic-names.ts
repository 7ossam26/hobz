/**
 * Arabic names used by the factories.
 *
 * Deliberately includes hamza/alef and ta-marbuta variants (أحمد / احمد,
 * فاطمة / فاطمه) because Phase 2's search normalizer must make them equivalent,
 * and a fixture set of only clean spellings would never catch that.
 */

export const ARABIC_FULL_NAMES = [
  'أحمد إبراهيم',
  'احمد ابراهيم',
  'فاطمة السيد',
  'فاطمه السيد',
  'محمد عبد الرحمن',
  'مريم خالد',
  'يوسف الشناوي',
  'نورهان مصطفى',
  'عمر عبد العزيز',
  'سارة الغندور',
  'كريم حجازي',
  'هبة الله فتحي',
] as const

export const ARABIC_CLIENT_NAMES = [
  'شركة النيل للتجارة',
  'مجموعة القاهرة الطبية',
  'مطاعم البحر الأحمر',
  'أكاديمية المستقبل',
] as const

export const ARABIC_PROJECT_NAMES = [
  'الهوية البصرية',
  'حملة رمضان',
  'الموقع الإلكتروني',
  'إدارة السوشيال ميديا',
] as const

/** Egyptian mobile numbers in both local and E.164 form, for normalisation tests. */
export const EGYPT_PHONES = [
  { local: '01001234567', e164: '+201001234567' },
  { local: '01112345678', e164: '+201112345678' },
  { local: '01234567890', e164: '+201234567890' },
  { local: '01512345678', e164: '+201512345678' },
] as const
