/**
 * FC.FOUNOUN – Luxury Footwear
 * Comprehensive Reproducible Test Suite
 *
 * Strictly imports the ACTUAL functions from the source code files:
 * 1. normalizeModelName from src/utils/modelNormalization.ts
 * 2. validateDualImageLimits, MAX_IMAGE_CHARS, MAX_COMBINED_CHARS from src/utils/imageOptimizer.ts
 * 3. validateStrictBase64, validateStrictWebP, validateStrictJpeg, calculateConservativeDocSize from src/utils/imageValidator.ts
 * 4. verifyTokenHeader, verifyTokenClaims, validateGoogleJwk, safeDecodeUriSegment from worker/worker.js
 */

import { normalizeModelName } from '../src/utils/modelNormalization';
import {
  validateDualImageLimits,
  MAX_IMAGE_CHARS,
  MAX_COMBINED_CHARS,
} from '../src/utils/imageOptimizer';
import {
  validateStrictBase64,
  validateStrictWebP,
  validateStrictJpeg,
  calculateConservativeDocSize,
} from '../src/utils/imageValidator';
import {
  verifyTokenHeader,
  verifyTokenClaims,
  validateGoogleJwk,
  safeDecodeUriSegment,
  buildWorkerFreezeUpdate,
  assertWorkerManagementPermission,
  assertSuperAdminManagementAccountsPermission,
  assertManagementAccountUpdateAllowed,
  buildResponsibleShiftReservationWrite,
  isExactParticipantPair,
  firestoreDocumentId,
  isOriginAllowed,
  convertToFirestoreFields,
  convertFromFirestoreFields,
  resolveCycleRecordedAt,
} from '../worker/worker.js';

export async function runAllTests() {
  console.log('====================================================');
  console.log('FC.FOUNOUN – وتشغيل حزمة الاختبارات التقنية المؤكدة');
  console.log('(يتم استيراد الدوال الفعلية مباشرة من ملفات المشروع)');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: unknown, testName: string, detail?: string) {
    if (Boolean(condition)) {
      console.log(`  ✓ [نجح] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [فشل] ${testName} - ${detail || 'شرط غير متحقق'}`);
      failed++;
    }
  }

  function assertThrowsWithCode(fn: () => unknown, expectedCode: string, testName: string, expectedStatus = 403) {
    try {
      fn();
      assert(false, testName, 'لم يتم رفض العملية');
    } catch (error) {
      const err = error as { status?: number; code?: string };
      assert(err.status === expectedStatus && err.code === expectedCode, testName, 'رمز الرفض أو الحالة غير صحيح');
    }
  }

  // 1. Test Name Normalization (casing and whitespace only, preserving Tashkeel & Tatweel)
  console.log('1. اختبارات توحيد الأسماء وحساب SHA-256 (من src/utils/modelNormalization.ts):');
  const n1 = await normalizeModelName('TRENTE');
  const n2 = await normalizeModelName('trente');
  const n3 = await normalizeModelName('  Trente   ');
  const n4 = await normalizeModelName('TrEnTe');

  assert(n1.normalized === 'trente', 'تحويل TRENTE إلى trente');
  assert(n2.normalized === 'trente', 'تأكيد ثبات trente');
  assert(n3.normalized === 'trente', 'إزالة المسافات الزائدة من Trente');
  assert(
    n1.hash === n2.hash && n2.hash === n3.hash && n3.hash === n4.hash,
    'تطابق كامل في هاش SHA-256 لجميع حالات الأحرف والمسافات لـ TRENTE'
  );
  assert(
    n1.original === 'TRENTE' && n3.original === 'Trente',
    'الاحتفاظ بالاسم الأصلي للعرض كما أدخله المستخدم'
  );

  // 1.1 Arabic: Casing & whitespace only (preserves Tashkeel and Tatweel as per user requirement)
  const arPlain = await normalizeModelName('  موديل فاخر  ');
  assert(arPlain.normalized === 'موديل فاخر', 'تقليم ودمج المسافات في النصوص العربية');

  const arWithTashkeel = await normalizeModelName('مَوْدِيلْ');
  assert(arWithTashkeel.normalized === 'مَوْدِيلْ', 'الحفاظ على التشكيل العربي دون حذف');

  const arWithTatweel = await normalizeModelName('مــــوديل');
  assert(arWithTatweel.normalized === 'مــــوديل', 'الحفاظ على الكشيدة والتطويل العربي دون حذف');

  // 2. Strict Base64 RFC 4648 (Imported from src/utils/imageValidator.ts)
  console.log('\n2. اختبارات التحقق الصارم من Base64 (من src/utils/imageValidator.ts):');
  const validB64_1 = Buffer.from('Hello FC.FOUNOUN luxury store').toString('base64');
  const b64Res1 = validateStrictBase64(validB64_1);
  assert(b64Res1.valid, 'قبول سلسلة Base64 صالحة مع الحشو السليم');

  const invalidLen = validateStrictBase64('ABC');
  assert(!invalidLen.valid && invalidLen.error?.includes('مضاعفاً'), 'رفض طول غير مضاعف لـ 4');

  const invalidChar = validateStrictBase64('AAAA#AAA');
  assert(!invalidChar.valid, 'رفض أحرف خارج أبجدية Base64');

  const unusedBitsFail = validateStrictBase64('AB==');
  assert(!unusedBitsFail.valid && unusedBitsFail.error?.includes('غير المستخدمة'), 'رفض البتات غير الصفرية في حشو Base64');

  const unusedBitsPass = validateStrictBase64('AA==');
  assert(unusedBitsPass.valid, 'قبول حشو Base64 عندما تكون البتات غير المستخدمة أصفاراً تماماً');

  // 3. WebP Strict RIFF Stream & Dimensions (Imported from src/utils/imageValidator.ts)
  console.log('\n3. اختبارات فحص WebP وتطابق المقاطع مع ترويسة RIFF المعلنة:');
  const vp8lPayload = Buffer.from([0x2f, 99, 0x00, 79 >> 2, 0x00]);
  const vp8lChunkSize = vp8lPayload.length;
  const paddedSize = 6;
  const riffPayload = 4 + 8 + paddedSize;

  const validWebpBuf = Buffer.alloc(8 + riffPayload);
  validWebpBuf.write('RIFF', 0, 'ascii');
  validWebpBuf.writeUInt32LE(riffPayload, 4);
  validWebpBuf.write('WEBP', 8, 'ascii');
  validWebpBuf.write('VP8L', 12, 'ascii');
  validWebpBuf.writeUInt32LE(vp8lChunkSize, 16);
  vp8lPayload.copy(validWebpBuf, 20);
  validWebpBuf[20 + vp8lChunkSize] = 0x00;

  const webpRes = validateStrictWebP(new Uint8Array(validWebpBuf));
  assert(webpRes.valid && webpRes.format === 'VP8L', 'قبول ملف WebP منظم بدقة مع مقطع VP8L وحشو RIFF');
  assert(webpRes.width === 100, 'استخراج العرض الصحيح (100px) من VP8L');

  // Test WebP with extra trailing bytes (must be strictly rejected)
  const webpWithTrailing = Buffer.concat([validWebpBuf, Buffer.from([0x99, 0x88, 0x77])]);
  const trailingRes = validateStrictWebP(new Uint8Array(webpWithTrailing));
  assert(!trailingRes.valid && trailingRes.error?.includes('عدم تطابق'), 'رفض ملف WebP يحتوي على بايتات زائدة بعد نهاية RIFF المعلنة');

  // Test WebP truncated (declared size > actual buffer)
  const truncatedWebp = validWebpBuf.subarray(0, validWebpBuf.length - 4);
  const truncRes = validateStrictWebP(new Uint8Array(truncatedWebp));
  assert(!truncRes.valid, 'رفض ملف WebP مبتور');

  // 4. Strict JPEG Segment Parsing & Boundary Alignment (Imported from src/utils/imageValidator.ts)
  console.log('\n4. اختبارات فحص مقاطع JPEG (من src/utils/imageValidator.ts):');
  const jpegBuf = Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x02, 0x58, 0x01, 0x01, 0x11, 0x00]), // SOF0
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x3f]), // SOS
    Buffer.from([0x12, 0x34, 0x56, 0x78]), // scan entropy data
    Buffer.from([0xff, 0xd9]), // EOI
  ]);

  const jpegRes = validateStrictJpeg(new Uint8Array(jpegBuf));
  assert(jpegRes.valid, 'قبول هيكل JPEG سليم يمتد من SOI حتى EOI بدقة');
  assert(jpegRes.width === 600 && jpegRes.height === 400, 'استخراج أبعاد JPEG بدقة (600x400)');

  const noEoi = jpegBuf.subarray(0, jpegBuf.length - 2);
  const noEoiRes = validateStrictJpeg(new Uint8Array(noEoi));
  assert(!noEoiRes.valid && noEoiRes.error?.includes('EOI'), 'رفض JPEG يفتقر إلى علامة نهاية الملف EOI');

  const jpegGarbage = Buffer.concat([jpegBuf, Buffer.from('malicious_trailing_payload')]);
  const garbageRes = validateStrictJpeg(new Uint8Array(jpegGarbage));
  assert(!garbageRes.valid && garbageRes.error?.includes('بيانات زائدة'), 'رفض JPEG يحتوي على حمولة متخفية بعد EOI');

  // 5. Conservative Document Size & Dual-Image Limits (Original Schema: weightMg, firstPositionMm, lastPositionMm)
  console.log('\n5. اختبار الحجم الاحترازي وحدود Data URL بالحقول الأصلية (weightMg, firstPositionMm, lastPositionMm):');
  const dummyImage1 = 'data:image/webp;base64,' + 'A'.repeat(250000);
  const dummyImage2 = 'data:image/webp;base64,' + 'B'.repeat(250000);

  assert(dummyImage1.length <= MAX_IMAGE_CHARS, `الصورة الأولى (${dummyImage1.length} محرف) تحت سقف ${MAX_IMAGE_CHARS}`);
  assert(dummyImage2.length <= MAX_IMAGE_CHARS, `الصورة الثانية (${dummyImage2.length} محرف) تحت سقف ${MAX_IMAGE_CHARS}`);

  const dualRes = validateDualImageLimits(dummyImage1.length, dummyImage2.length);
  assert(dualRes.valid, `مجموع الصورتين بالكامل (${dualRes.totalChars} محرف) تحت سقف ${MAX_COMBINED_CHARS}`);

  const sampleDoc = {
    id: 'mod_luxury_test_123',
    name: 'حذاء كلاسيكي فنون فاخر',
    name_hash: n1.hash,
    category: 'صيافي' as const,
    image1: dummyImage1,
    image2: dummyImage2,
    weightMg: 450000,
    firstPositionMm: 285,
    lastPositionMm: 98,
    createdBy: 'admin_uid_777',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sizeRes = calculateConservativeDocSize(sampleDoc);
  assert(sizeRes.underSafeCeiling, `الحجم التقديري للوثيقة (${Math.round(sizeRes.estimatedBytes / 1024)} KB) يقع بأمان تحت سقف 750 KB`);

  // 6. Security Audit: Header & JWK Validation (Imported directly from worker/worker.js)
  console.log('\n6. اختبارات أمان JWT و JWK المستوردة مباشرة من worker/worker.js:');

  // 6.1 header.typ validation
  let typPass = false;
  try {
    verifyTokenHeader({ typ: 'JWT', alg: 'RS256', kid: 'google-key-1' });
    typPass = true;
  } catch {}
  assert(typPass, 'قبول ترويسة JWT تحتوي على typ=JWT و alg=RS256 و kid');

  let typFail = false;
  try {
    verifyTokenHeader({ typ: 'JOSE', alg: 'RS256', kid: 'google-key-1' });
  } catch (err: any) {
    typFail = err.code === 'invalid_jwt_type';
  }
  assert(typFail, 'رفض ترويسة typ غير مطابقة لـ JWT (مثل JOSE)');

  let missingTypFail = false;
  try {
    verifyTokenHeader({ alg: 'RS256', kid: 'google-key-1' });
  } catch (err: any) {
    missingTypFail = err.code === 'invalid_jwt_type';
  }
  assert(missingTypFail, 'رفض ترويسة تفتقر إلى typ');

  // 6.2 JWK strict structure verification
  const validGoogleJwk = {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid: 'key-test-123',
    n: 'u1lO6n3A_44gJjKlmNopQrStUvWxYz0123456789AbCdEfGhIj',
    e: 'AQAB',
  };

  let jwkPass = false;
  try {
    validateGoogleJwk(validGoogleJwk, 'key-test-123');
    jwkPass = true;
  } catch {}
  assert(jwkPass, 'قبول مفتاح Google JWK كامل مع kty=RSA و use=sig و alg=RS256 و n و e');

  let jwkUseFail = false;
  try {
    validateGoogleJwk({ ...validGoogleJwk, use: 'enc' }, 'key-test-123');
  } catch (err: any) {
    jwkUseFail = err.code === 'invalid_jwk_use';
  }
  assert(jwkUseFail, 'رفض مفتاح JWK لا يحتوي على use=sig');

  let jwkAlgFail = false;
  try {
    validateGoogleJwk({ ...validGoogleJwk, alg: 'HS256' }, 'key-test-123');
  } catch (err: any) {
    jwkAlgFail = err.code === 'invalid_jwk_alg';
  }
  assert(jwkAlgFail, 'رفض مفتاح JWK لا يحتوي على alg=RS256');

  let jwkKidFail = false;
  try {
    validateGoogleJwk(validGoogleJwk, 'different-kid');
  } catch (err: any) {
    jwkKidFail = err.code === 'mismatched_jwk_kid';
  }
  assert(jwkKidFail, 'رفض مفتاح JWK غير مطابق لمعرّف kid في ترويسة التوكن');

  let jwkModulusFail = false;
  try {
    validateGoogleJwk({ ...validGoogleJwk, n: 'short' }, 'key-test-123');
  } catch (err: any) {
    jwkModulusFail = err.code === 'invalid_jwk_modulus';
  }
  assert(jwkModulusFail, 'رفض مفتاح JWK بمعامل n غير صالح');

  // 7. Security Audit: Timing Claims (exp > now, iat, auth_time <= iat)
  console.log('\n7. اختبارات مطالبات التوقيت الصارمة المستوردة مباشرة من worker/worker.js:');
  const fixedNow = 1700000000;
  const validClaims = {
    iss: 'https://securetoken.google.com/fc-founoun',
    aud: 'fc-founoun',
    sub: 'admin_user_456',
    iat: fixedNow - 100,
    auth_time: fixedNow - 150, // auth_time <= iat
    exp: fixedNow + 3500, // exp > now
  };

  let claimsPass = false;
  try {
    verifyTokenClaims(validClaims, 'fc-founoun', fixedNow);
    claimsPass = true;
  } catch {}
  assert(claimsPass, 'قبول مطالبات توقيت سليمة: exp في المستقبل و auth_time <= iat');

  let expExpired = false;
  try {
    verifyTokenClaims({ ...validClaims, exp: fixedNow }, 'fc-founoun', fixedNow);
  } catch (err: any) {
    expExpired = err.code === 'token_expired';
  }
  assert(expExpired, 'رفض exp عندما يكون مساوياً أو أصغر من الوقت الحالي (exp > nowSec حصراً)');

  let authExceedsIat = false;
  try {
    // auth_time is AFTER iat (impossible in valid authentication flows)
    verifyTokenClaims({ ...validClaims, auth_time: validClaims.iat + 50 }, 'fc-founoun', fixedNow);
  } catch (err: any) {
    authExceedsIat = err.code === 'invalid_auth_time';
  }
  assert(authExceedsIat, 'رفض التوكن عندما يتجاوز auth_time تاريخ إصدار الرمز iat');

  let authInFuture = false;
  try {
    // auth_time is far in the future
    verifyTokenClaims({ ...validClaims, iat: fixedNow + 500, auth_time: fixedNow + 500 }, 'fc-founoun', fixedNow);
  } catch (err: any) {
    authInFuture = err.code === 'invalid_iat' || err.code === 'invalid_auth_time';
  }
  assert(authInFuture, 'رفض التوكن عند وقوع auth_time في المستقبل خارج هامش الانحراف المعتمد');

  // 8. Safe URI Component Decoding (400 instead of 500 on malformed URI)
  console.log('\n8. اختبارات فك تشفير مسارات URI الآمنة (من worker/worker.js):');
  const normalDecoded = safeDecodeUriSegment('mod_luxury_shoe_001');
  assert(normalDecoded === 'mod_luxury_shoe_001', 'فك تشفير معرّف موديل سليم');

  const percentDecoded = safeDecodeUriSegment('mod%5Ftest%5F99');
  assert(percentDecoded === 'mod_test_99', 'فك تشفير معرّف يحتوي على ترميز النسبة المئوية %5F');

  let malformedCaught = false;
  let malformedStatus = 0;
  try {
    // '%E0%A4%A' is invalid incomplete UTF-8 in decodeURIComponent
    safeDecodeUriSegment('%E0%A4%A');
  } catch (err: any) {
    malformedCaught = true;
    malformedStatus = err.status;
  }
  assert(malformedCaught && malformedStatus === 400, 'إرجاع رمز الحالة 400 (Bad Request) بدلاً من 500 عند وجود معرّف مشوّه في المسار');

  // Management account administration is exclusive to the super admin.
  console.log('\\n9. اختبارات حصرية إدارة حسابات المديرين والمسؤولين:');
  assert(assertSuperAdminManagementAccountsPermission('super_admin') === true, 'السماح للمشرف العام بإدارة حسابات الإدارة');
  for (const role of ['admin', 'responsible']) {
    assertThrowsWithCode(() => assertSuperAdminManagementAccountsPermission(role), 'super_admin_only_management_accounts', `رفض ${role} من إدارة حسابات المديرين والمسؤولين`);
  }
  assertThrowsWithCode(
    () => assertManagementAccountUpdateAllowed({ role: 'admin', status: 'active' }, { status: 'inactive' }, [], 'mgr_self', 'mgr_self'),
    'cannot_freeze_self',
    'منع المشرف العام من تجميد حسابه بنفسه'
  );
  assert(assertManagementAccountUpdateAllowed(
    { role: 'responsible', status: 'inactive', shift: 'day' },
    { status: 'active' },
    [],
    'mgr_old', 'mgr_super'
  ) === true, 'السماح بإعادة تفعيل مسؤول إذا كانت ورديته غير مشغولة');
  assertThrowsWithCode(
    () => assertManagementAccountUpdateAllowed(
      { role: 'responsible', status: 'inactive', shift: 'day' },
      { status: 'active' },
      [{ uid: 'mgr_day', role: 'responsible', status: 'active', shift: 'day' }],
      'mgr_old', 'mgr_super'
    ),
    'responsible_shift_taken',
    'منع تفعيل مسؤولين اثنين في الوردية نفسها',
    409
  );

  const daySlotPath = 'projects/test-project/databases/(default)/documents/management_responsible_slots/day';
  const firstDayReservation: any = buildResponsibleShiftReservationWrite('test-project', 'mgr_first', 'day', null, true);
  assert(firstDayReservation?.currentDocument.exists === false && firstDayReservation?.update.name === daySlotPath,
    'حجز وردية جديدة بشرط عدم وجود حجز سابق');
  const occupiedDaySlot = {
    updateTime: '2026-11-04T10:00:00.000000Z',
    fields: convertToFirestoreFields({ uid: 'mgr_first', shift: 'day', status: 'active' })
  };
  assertThrowsWithCode(
    () => buildResponsibleShiftReservationWrite('test-project', 'mgr_second', 'day', occupiedDaySlot, true),
    'responsible_shift_taken',
    'رفض حجز وردية نشطة لمسؤول آخر',
    409
  );
  const releaseDaySlot: any = buildResponsibleShiftReservationWrite('test-project', 'mgr_first', 'day', occupiedDaySlot, false);
  assert(releaseDaySlot !== null && releaseDaySlot.currentDocument.updateTime === occupiedDaySlot.updateTime &&
    (convertFromFirestoreFields(releaseDaySlot.update.fields) as any).status === 'inactive',
    'تحرير الوردية بتحديث مشروط يمنع الكتابة فوق حجز أحدث');
  assert(buildResponsibleShiftReservationWrite('test-project', 'mgr_second', 'day', occupiedDaySlot, false) === null,
    'عدم تحرير حجز يخص مسؤولاً آخر');

  // 9. Worker account freeze is reversible; the record is retained, never hard-deleted.
  console.log('\n9. اختبارات تجميد حساب العامل دون حذفه:');
  assert(assertWorkerManagementPermission('admin', 'POST') === true, 'السماح للمدير العام بإضافة مشرفي العمال');
  assert(assertWorkerManagementPermission('admin', 'PUT', 'pin') === true, 'السماح للمدير العام بتعيين كود دخول مشرف العمال');
  assert(assertWorkerManagementPermission('admin', 'GET') === true, 'السماح للمدير العام بقراءة قائمة مشرفي العمال');
  assert(assertWorkerManagementPermission('responsible', 'GET') === true, 'السماح للمسؤول بعرض قائمة مشرفي العمال');
  assert(assertWorkerManagementPermission('responsible', 'POST') === true, 'السماح للمسؤول بإضافة مشرفي العمال');
  assert(assertWorkerManagementPermission('responsible', 'PUT') === true, 'السماح للمسؤول بتعديل بيانات وتعيين مشرف العمال');
  assert(assertWorkerManagementPermission('responsible', 'PUT', 'pin') === true, 'السماح للمسؤول بتغيير كود دخول مشرف العمال');
  assert(assertWorkerManagementPermission('responsible', 'DELETE') === true, 'السماح للمسؤول بتجميد حساب مشرف العمال دون حذفه نهائياً');
  assert(assertWorkerManagementPermission('admin', 'DELETE') === true, 'السماح للمدير العام بتجميد حساب مشرف العمال مع منع حذف حسابات الإدارة');
  assert(assertWorkerManagementPermission('super_admin', 'DELETE') === true, 'السماح للمشرف العام بتجميد حساب مشرف العمال');
  assert(isExactParticipantPair(['user_a', 'user_b'], 'user_a', 'user_b'), 'قبول محادثة بين طرفين محددين');
  assert(!isExactParticipantPair(['user_a', 'user_b', 'user_c'], 'user_a', 'user_b'), 'رفض قراءة محادثة تضم طرفاً ثالثاً');
  assert(!isExactParticipantPair(['user_a', 'user_a'], 'user_a', 'user_b'), 'رفض قائمة مشاركين مكررة أو غير مطابقة');
  assert(firestoreDocumentId('projects/p/databases/(default)/documents/users/user_123') === 'user_123', 'استخراج معرّف المستخدم من مسار وثيقة Firestore');
  assert(firestoreDocumentId('') === '', 'إرجاع معرّف فارغ لمسار وثيقة غير صالح');
  assert(isOriginAllowed('https://deploy-preview-3--fc-founoun.netlify.app', {}), 'السماح لمعاينة Netlify المعتمدة بالاتصال بالخادم');
  assert(!isOriginAllowed('https://example-attacker.net', {}), 'رفض مصدر خارجي غير معتمد عبر CORS');
  const firestoreRoundTrip = convertFromFirestoreFields(convertToFirestoreFields({ participants: ['user_a', 'user_b'], metadata: { active: true, roles: ['worker', 'admin'] } })) as { participants: string[]; metadata: { active: boolean; roles: string[] } };
  assert(Array.isArray(firestoreRoundTrip.participants) && firestoreRoundTrip.participants.join(',') === 'user_a,user_b', 'حفظ واسترجاع مصفوفة المشاركين بصيغة Firestore ArrayValue');
  assert(firestoreRoundTrip.metadata.active === true && firestoreRoundTrip.metadata.roles.join(',') === 'worker,admin', 'حفظ واسترجاع المصفوفات والكائنات المتداخلة في Firestore');
  const originalWorker = { id: 'wkr_test_001', name: 'عامل اختبار', status: 'active', phone: '20000000' };
  const frozenWorker = buildWorkerFreezeUpdate(originalWorker, '2026-11-04T10:00:00.000Z');
  assert(frozenWorker.status === 'inactive', 'تحويل حالة العامل إلى inactive عند التجميد');
  assert(frozenWorker.id === originalWorker.id && frozenWorker.name === originalWorker.name, 'الاحتفاظ بسجل العامل وبياناته دون حذف');
  assert(frozenWorker.frozenAt === '2026-11-04T10:00:00.000Z' && frozenWorker.updatedAt === frozenWorker.frozenAt, 'تسجيل وقت التجميد والتحديث');
  // 10. Machine-cycle report timestamps survive offline synchronization.
  console.log('\\n10. اختبارات وقت تسجيل تقارير دورات المكائن والمزامنة دون اتصال:');
  const cycleServerNow = new Date('2026-11-04T20:00:00.000Z');
  assert(
    resolveCycleRecordedAt('2026-11-04T18:30:00.000Z', cycleServerNow) === '2026-11-04T18:30:00.000Z',
    'الاحتفاظ بوقت التسجيل الأصلي عند مزامنة تقرير محفوظ دون اتصال'
  );
  assert(
    resolveCycleRecordedAt(undefined, cycleServerNow) === cycleServerNow.toISOString(),
    'استخدام وقت الخادم تلقائياً للعملاء الذين لا يرسلون وقتاً'
  );
  let invalidCycleTimeRejected = false;
  try { resolveCycleRecordedAt('not-a-date', cycleServerNow); }
  catch (err: any) { invalidCycleTimeRejected = err.code === 'invalid_cycle_recorded_at'; }
  assert(invalidCycleTimeRejected, 'رفض وقت تسجيل غير صالح');
  let futureCycleTimeRejected = false;
  try { resolveCycleRecordedAt('2026-11-04T20:10:00.000Z', cycleServerNow); }
  catch (err: any) { futureCycleTimeRejected = err.code === 'future_cycle_recorded_at'; }
  assert(futureCycleTimeRejected, 'رفض وقت تسجيل يقع في المستقبل بأكثر من خمس دقائق');


  console.log('\n====================================================');
  console.log(`إجمالي الاختبارات: ${passed + failed} | نجح: ${passed} | فشل: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('حدث استثناء غير معالج أثناء الاختبارات:', err);
  process.exit(1);
});
