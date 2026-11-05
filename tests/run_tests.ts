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
import { normalizeMutationInit } from '../src/utils/offlineQueue';
import { getMissingFirebaseConfig } from '../src/utils/firebaseConfig';
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
  assertWorkerPinCreationAllowed,
  assertTaskManagementPermission,
  assertTaskCreationFieldsAllowed,
  buildResourceCreationId,
  isSameResourceCreation,
  resourceCreationFingerprint,
  assertTaskUpdateStatusAllowed,
  assertResponsibleWorkerFieldsAllowed,
  sanitizeWorkerOutputForRole,
  assertSuperAdminManagementAccountsPermission,
  assertManagementAccountUpdateAllowed,
  buildResponsibleShiftReservationWrite,
  buildWorkerMachineReservationWrite,
  workerMachineSlotPath,
  isExactParticipantPair,
  firestoreDocumentId,
  isOriginAllowed,
  convertToFirestoreFields,
  convertFromFirestoreFields,
  resolveCycleRecordedAt,
  getCycleReportWriteDecision,
  buildLoginAttemptRecord,
  assertWorkerTaskProgressAccess,
  computePinPbkdf2,
  computeStoredPinHash,
  buildNotificationQuery,
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

  // Firebase Web config validation must accept real Firebase sender IDs and app IDs.
  console.log('0. اختبارات التحقق من إعدادات Firebase:');
  const validFirebaseConfig = getMissingFirebaseConfig({
    apiKey: 'AIzaSyA12345678901234567890123456789012',
    messagingSenderId: '761551234567',
    appId: '1:761551234567:web:abcdef0123456789',
  });
  assert(validFirebaseConfig.length === 0, 'قبول معرّف المرسل ومعرّف تطبيق Firebase الصحيحين');
  const invalidFirebaseConfig = getMissingFirebaseConfig({
    apiKey: 'invalid',
    messagingSenderId: 'not-numeric',
    appId: 'wrong-app-id',
  });
  assert(
    invalidFirebaseConfig.join(',') === 'VITE_FIREBASE_API_KEY,VITE_FIREBASE_MESSAGING_SENDER_ID,VITE_FIREBASE_APP_ID',
    'رفض إعدادات Firebase غير الصالحة مع تسمية المتغيرات الناقصة بدقة'
  );

  // Notification queries must scope reads to the authenticated recipient.
  const notificationQuery = buildNotificationQuery('worker_123');
  assert(
    notificationQuery.structuredQuery.where.fieldFilter.field.fieldPath === 'recipientUid' &&
    notificationQuery.structuredQuery.where.fieldFilter.value.stringValue === 'worker_123',
    'حصر قراءة الإشعارات في حساب المستلم فقط'
  );
  assert(notificationQuery.structuredQuery.limit === 200, 'تحديد حجم قراءة الإشعارات لتفادي تحميل غير محدود');
  let invalidNotificationRecipientRejected = false;
  try { buildNotificationQuery(''); } catch (error) {
    invalidNotificationRecipientRejected = (error as { code?: string }).code === 'invalid_notification_recipient';
  }
  assert(invalidNotificationRecipientRejected, 'رفض معرّف مستلم إشعار غير صالح');

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

  // 1.2 PBKDF2 PIN hashing: stay within the Cloudflare WebCrypto 100,000-iteration limit.
  console.log('\n1.2 اختبارات تشفير PIN المتوافق مع Cloudflare WebCrypto:');
  const pinSalt = 'fc-founoun-test-salt';
  const pinHash = await computePinPbkdf2(pinSalt, '123456');
  assert(/^[a-f0-9]{64}$/.test(pinHash), 'إنتاج هاش PBKDF2-SHA256 بطول 256 بت');
  const storedV2 = { pin_algo: 'pbkdf2-sha256-v2', pin_iterations: 100000, pin_salt: pinSalt, pin_hash: pinHash };
  const verifiedV2 = await computeStoredPinHash(storedV2, '123456', 'رمز الاختبار');
  assert(verifiedV2 === pinHash, 'التحقق من PIN الجديد بإعداد 100000 دورة');
  let legacyPinResetRequired = false;
  try {
    await computeStoredPinHash({ pin_algo: 'pbkdf2-sha256-v1', pin_salt: pinSalt, pin_hash: 'legacy' }, '123456', 'رمز الاختبار');
  } catch (error) {
    legacyPinResetRequired = (error as { code?: string }).code === 'pin_reset_required';
  }
  assert(legacyPinResetRequired, 'رفض هاش PBKDF2 القديم برسالة إعادة تعيين واضحة بدلاً من خطأ WebCrypto');

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

  // Atomic worker machine/shift reservations.
  console.log('\\n9. اختبارات حجز المكينة والوردية ذرياً:');
  const workerSlotPath = 'projects/test-project/databases/(default)/documents/worker_machine_slots/m1_day';
  const firstWorkerSlot: any = buildWorkerMachineReservationWrite('test-project', 'wkr_first', 1, 'day', null, true);
  assert(workerSlotPath === firstWorkerSlot.update.name && firstWorkerSlot.currentDocument.exists === false,
    'إنشاء حجز المكينة والوردية بشرط عدم وجود حجز سابق');
  assert(workerMachineSlotPath(3, 'night') === 'worker_machine_slots/m3_night',
    'تكوين معرّف حجز فريد لكل مكينة ووردية');
  const occupiedWorkerSlot = {
    updateTime: '2026-11-04T10:00:00.000000Z',
    fields: convertToFirestoreFields({ workerId: 'wkr_first', machineNumber: 1, shift: 'day', status: 'active' })
  };
  assertThrowsWithCode(
    () => buildWorkerMachineReservationWrite('test-project', 'wkr_second', 1, 'day', occupiedWorkerSlot, true),
    'machine_shift_already_assigned',
    'رفض حجز مكينة ووردية نشطتين لعامل آخر',
    409
  );
  const releaseWorkerSlot: any = buildWorkerMachineReservationWrite('test-project', 'wkr_first', 1, 'day', occupiedWorkerSlot, false);
  assert(releaseWorkerSlot.currentDocument.updateTime === occupiedWorkerSlot.updateTime &&
    (convertFromFirestoreFields(releaseWorkerSlot.update.fields) as any).status === 'inactive',
    'تحرير الحجز بتحديث مشروط على النسخة الحالية');
  assert(buildWorkerMachineReservationWrite('test-project', 'wkr_second', 1, 'day', occupiedWorkerSlot, false) === null,
    'منع عامل من تحرير حجز يخص عاملاً آخر');
  const inactiveWorkerSlot = {
    updateTime: '2026-11-04T11:00:00.000000Z',
    fields: convertToFirestoreFields({ workerId: 'wkr_first', machineNumber: 1, shift: 'day', status: 'inactive' })
  };
  const reuseWorkerSlot: any = buildWorkerMachineReservationWrite('test-project', 'wkr_second', 1, 'day', inactiveWorkerSlot, true);
  assert(reuseWorkerSlot.currentDocument.updateTime === inactiveWorkerSlot.updateTime,
    'السماح بإعادة استخدام حجز محرر مع شرط updateTime');

  // A worker retry must reach the idempotency ledger even after the task was completed by that same mutation.
  assert(assertWorkerTaskProgressAccess({ assignedWorkerId: 'worker_1', status: 'completed' }, 'worker_1') === true,
    'السماح لطلب الإنجاز المكرر بالوصول إلى سجل منع التكرار حتى بعد اكتمال المهمة');
  assertThrowsWithCode(
    () => assertWorkerTaskProgressAccess({ assignedWorkerId: 'worker_2', status: 'completed' }, 'worker_1'),
    'task_not_assigned',
    'منع العامل من إرسال إنجاز لمهمة غير مسندة إليه حتى عند إعادة المحاولة',
    403
  );

  // 9. Worker account freeze is reversible; the record is retained, never hard-deleted.
  console.log('\n9. اختبارات تجميد حساب العامل دون حذفه:');
  assert(assertTaskUpdateStatusAllowed('in_progress', 'pending') === true,
    'السماح بتعليق مهمة مفتوحة أو قيد التنفيذ');
  assert(assertTaskUpdateStatusAllowed('pending', 'in_progress') === true,
    'السماح باستئناف المهمة المعلقة');
  assertThrowsWithCode(
    () => assertTaskUpdateStatusAllowed('in_progress', 'completed'),
    'invalid_task_status',
    'منع إغلاق المهمة مكتملة دون تسجيل كامل الإنجاز',
    400
  );
  assertThrowsWithCode(
    () => assertTaskUpdateStatusAllowed('completed', 'in_progress'),
    'task_not_changeable',
    'منع إعادة فتح مهمة مكتملة عبر مسار التعديل الإداري',
    409
  );
  const createMutationId = '123e4567-e89b-42d3-a456-426614174000';
  assert(buildResourceCreationId('workers', createMutationId) === 'wkr_123e4567e89b42d3a456426614174000',
    'تكوين معرّف ثابت لإنشاء العامل من معرّف العملية');
  assert(buildResourceCreationId('tasks', createMutationId) === 'tsk_123e4567e89b42d3a456426614174000',
    'تكوين معرّف ثابت لإنشاء أمر الإنتاج من معرّف العملية');
  assert(isSameResourceCreation(
    { creationMutationId: createMutationId, creationFingerprint: resourceCreationFingerprint({ name: 'عامل', machineNumber: 1, shift: 'day' }, 'workers'), createdBy: 'admin_1', name: 'عامل', machineNumber: 1, shift: 'day', status: 'inactive' },
    { name: 'عامل', machineNumber: 1, shift: 'day' },
    'workers', createMutationId, 'admin_1'
  ), 'اعتبار إعادة طلب إنشاء العامل نفسه من الحساب نفسه عملية مكررة آمنة');
  assert(!isSameResourceCreation(
    { creationMutationId: createMutationId, creationFingerprint: resourceCreationFingerprint({ name: 'عامل آخر', machineNumber: 1, shift: 'day' }, 'workers'), createdBy: 'admin_1', name: 'عامل آخر', machineNumber: 1, shift: 'day', status: 'active' },
    { name: 'عامل', machineNumber: 1, shift: 'day' },
    'workers', createMutationId, 'admin_1'
  ), 'رفض إعادة استخدام معرّف الإنشاء لمحتوى مختلف');
  assert(!isSameResourceCreation(
    { creationMutationId: createMutationId, creationFingerprint: resourceCreationFingerprint({ name: 'عامل', machineNumber: 1, shift: 'day' }, 'workers'), createdBy: 'admin_1', name: 'عامل', machineNumber: 1, shift: 'day', status: 'active' },
    { name: 'عامل', machineNumber: 1, shift: 'day' },
    'workers', createMutationId, 'admin_2'
  ), 'رفض إعادة استخدام معرّف إنشاء تابع لحساب آخر');
  assertThrowsWithCode(
    () => buildResourceCreationId('workers', 'not-a-uuid'),
    'invalid_mutation_id',
    'رفض معرّف إنشاء غير صالح',
    400
  );
  assert(assertTaskCreationFieldsAllowed({ title: 'أمر إنتاج', targetQuantity: 50 }) === true,
    'السماح بإنشاء مهمة جديدة دون التلاعب بحالة الإنجاز');
  assertThrowsWithCode(
    () => assertTaskCreationFieldsAllowed({ title: 'أمر إنتاج', completedQuantity: 30 }),
    'completed_quantity_read_only',
    'منع تزوير كمية منجزة عند إنشاء المهمة',
    400
  );
  assertThrowsWithCode(
    () => assertTaskCreationFieldsAllowed({ title: 'أمر إنتاج', status: 'completed' }),
    'invalid_initial_task_status',
    'منع إنشاء مهمة بحالة مكتملة قبل تسجيل الإنجاز',
    400
  );
  assert(assertTaskManagementPermission('admin') === true, 'السماح للمدير العام بإدارة مهام الإنتاج');
  assert(assertTaskManagementPermission('super_admin') === true, 'السماح للمشرف العام بإدارة مهام الإنتاج');
  assertThrowsWithCode(
    () => assertTaskManagementPermission('responsible'),
    'task_management_forbidden',
    'منع المسؤول من إدارة مهام الإنتاج',
    403
  );
  assertThrowsWithCode(
    () => assertTaskManagementPermission('worker'),
    'task_management_forbidden',
    'منع مشرف العمال من إدارة مهام الإنتاج الإدارية',
    403
  );
  assert(assertWorkerManagementPermission('admin', 'POST') === true, 'السماح للمدير العام بإضافة مشرفي العمال');
  assertThrowsWithCode(() => assertWorkerManagementPermission('admin', 'PUT', 'pin'), 'worker_pin_super_admin_only', 'منع المدير العام من تعيين PIN مشرف العمال', 403);
  assert(assertWorkerManagementPermission('admin', 'GET') === true, 'السماح للمدير العام بقراءة قائمة مشرفي العمال');
  assert(assertWorkerManagementPermission('responsible', 'GET') === true, 'السماح للمسؤول بعرض قائمة مشرفي العمال');
  assert(assertWorkerManagementPermission('responsible', 'POST') === true, 'السماح للمسؤول بإضافة مشرفي العمال');
  const workerPrivateRecord = { id: 'wkr_1', name: 'عامل', phone: '123456', email: 'worker@example.test', notes: 'خاص', status: 'active', machineNumber: 1, shift: 'day', pin_hash: 'secret-hash' };
  const responsibleWorkerView = sanitizeWorkerOutputForRole(workerPrivateRecord, 'responsible');
  assert(!('phone' in responsibleWorkerView) && !('email' in responsibleWorkerView) && !('notes' in responsibleWorkerView) && !('pin_hash' in responsibleWorkerView),
    'حجب بيانات الاتصال والملاحظات وأسرار PIN عن المسؤول');
  const adminWorkerView = sanitizeWorkerOutputForRole(workerPrivateRecord, 'admin');
  assert(adminWorkerView.phone === '123456' && adminWorkerView.email === 'worker@example.test' && !('pin_hash' in adminWorkerView),
    'إظهار بيانات العامل للمدير مع حجب أسرار PIN');
  assert(assertResponsibleWorkerFieldsAllowed('responsible', { name: 'عامل', machineNumber: 1, shift: 'day' }) === true,
    'السماح للمسؤول بإنشاء مشرف عامل بالاسم والمكينة والوردية');
  assert(assertResponsibleWorkerFieldsAllowed('admin', { name: 'عامل', phone: '123', notes: 'ملاحظات' }) === true,
    'عدم تقييد صلاحيات المدير العام في بيانات العامل');
  assertThrowsWithCode(
    () => assertResponsibleWorkerFieldsAllowed('responsible', { name: 'عامل', machineNumber: 1, shift: 'day', phone: '123' }),
    'responsible_worker_field_forbidden',
    'منع المسؤول من إدخال بيانات اتصال العامل',
    403
  );
  assertThrowsWithCode(
    () => assertResponsibleWorkerFieldsAllowed('responsible', { name: 'عامل', machineNumber: 1, shift: 'day', notes: 'ملاحظات داخلية' }),
    'responsible_worker_field_forbidden',
    'منع المسؤول من إدخال ملاحظات خارج صلاحياته',
    403
  );
  assert(assertWorkerManagementPermission('responsible', 'PUT') === true, 'السماح للمسؤول بتعديل بيانات وتعيين مشرف العمال');
  assertThrowsWithCode(() => assertWorkerManagementPermission('responsible', 'PUT', 'pin'), 'worker_pin_super_admin_only', 'منع المسؤول من تعيين PIN مشرف العمال', 403);
  assert(assertWorkerPinCreationAllowed('super_admin', '123456') === true, 'السماح للمشرف العام بتعيين PIN عند إنشاء العامل');
  assertThrowsWithCode(() => assertWorkerPinCreationAllowed('admin', '123456'), 'worker_pin_super_admin_only', 'منع المدير العام من تعيين PIN عند إنشاء العامل', 403);
  assertThrowsWithCode(() => assertWorkerPinCreationAllowed('super_admin', '12345'), 'invalid_pin', 'رفض PIN العامل إذا لم يتكون من 6 أرقام', 400);
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
  const latestCycle = {
    workerId: 'worker_123',
    count: 1800,
    photo: 'data:image/jpeg;base64,QUJD',
    recordedAt: '2026-11-04T19:00:00.000Z',
  };
  assert(
    getCycleReportWriteDecision(latestCycle, {
      workerId: 'worker_123', count: 1800, photo: 'data:image/jpeg;base64,QUJD',
      recordedAt: '2026-11-04T19:00:00.000Z',
    }) === 'duplicate',
    'اعتبار إعادة إرسال التقرير نفسه بالوقت والبيانات نفسيهما عملية مكررة آمنة'
  );
  let staleCycleRejected = false;
  try {
    getCycleReportWriteDecision(latestCycle, {
      workerId: 'worker_123', count: 900, photo: 'data:image/jpeg;base64,REVG',
      recordedAt: '2026-11-04T18:00:00.000Z',
    });
  } catch (err: any) { staleCycleRejected = err.code === 'stale_cycle_report' && err.status === 409; }
  assert(staleCycleRejected, 'رفض تقرير قديم يصل بعد تقرير أحدث أثناء المزامنة');
  let conflictingCycleRejected = false;
  try {
    getCycleReportWriteDecision(latestCycle, {
      workerId: 'worker_123', count: 2000, photo: 'data:image/jpeg;base64,SElK',
      recordedAt: '2026-11-04T19:00:00.000Z',
    });
  } catch (err: any) { conflictingCycleRejected = err.code === 'cycle_report_timestamp_conflict' && err.status === 409; }
  assert(conflictingCycleRejected, 'رفض تقرير مختلف يحمل وقت التسجيل نفسه بدل استبدال البيانات');
  assert(
    getCycleReportWriteDecision(latestCycle, {
      workerId: 'worker_123', count: 1900, photo: 'data:image/jpeg;base64,S0xN',
      recordedAt: '2026-11-04T19:30:00.000Z',
    }) === 'write',
    'السماح بتحديث التقرير عندما يكون وقت التسجيل أحدث فعلاً'
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


  console.log('\\n11. اختبارات عداد محاولات الدخول المتزامنة:');
  const loginNow = Date.parse('2026-11-05T08:00:00.000Z');
  let attemptsRecord: any = {};
  for (let i = 1; i <= 4; i++) {
    attemptsRecord = buildLoginAttemptRecord('workerId', 'wkr_login_test', attemptsRecord, loginNow + i * 1000, false);
    assert(attemptsRecord.count === i && attemptsRecord.lockedUntil === 0,
      `احتساب محاولة الدخول الفاشلة رقم ${i} دون فقدان العداد`);
  }
  attemptsRecord = buildLoginAttemptRecord('workerId', 'wkr_login_test', attemptsRecord, loginNow + 5000, false);
  assert(attemptsRecord.count === 0 && attemptsRecord.lockedUntil === loginNow + 5 * 1000 + 15 * 60 * 1000,
    'قفل الحساب لمدة 15 دقيقة بعد خمس محاولات فاشلة');
  let lockedLoginRejected = false;
  try { buildLoginAttemptRecord('workerId', 'wkr_login_test', attemptsRecord, loginNow + 6000, false); }
  catch (err: any) { lockedLoginRejected = err.status === 429 && err.code === 'login_locked'; }
  assert(lockedLoginRejected, 'رفض المحاولات أثناء فترة القفل');
  const resetLoginAttempts = buildLoginAttemptRecord('uid', 'mgr_login_test', attemptsRecord, loginNow + 16 * 60 * 1000, true);
  assert(resetLoginAttempts.count === 0 && resetLoginAttempts.lockedUntil === 0 && Object.prototype.hasOwnProperty.call(resetLoginAttempts, 'uid'),
    'إعادة تصفير عداد المحاولات بعد دخول صحيح وانتهاء القفل');

  console.log('====================================================\n');

  console.log('\\n12. اختبارات تجهيز عمليات المزامنة للتخزين المحلي:');
  const normalizedQueueInit = normalizeMutationInit({
    method: 'POST',
    body: JSON.stringify({ count: 25, photo: 'data:image/webp;base64,AAAA' }),
    headers: { 'X-Request-Source': 'offline-queue' }
  });
  assert(normalizedQueueInit.method === 'POST' &&
    normalizedQueueInit.body?.includes('"count":25') === true &&
    normalizedQueueInit.headers?.['X-Request-Source'] === 'offline-queue',
    'حفظ طريقة الطلب والحمولة والرؤوس في سجل قابل للاسترجاع من IndexedDB');
  let unsupportedQueueBodyRejected = false;
  try { normalizeMutationInit({ method: 'POST', body: { binary: true } as unknown as BodyInit }); }
  catch { unsupportedQueueBodyRejected = true; }
  assert(unsupportedQueueBodyRejected, 'رفض حمولة غير نصية حتى لا تتحول العملية المحفوظة إلى بيانات تالفة');

  console.log(`إجمالي الاختبارات: ${passed + failed} | نجح: ${passed} | فشل: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('حدث استثناء غير معالج أثناء الاختبارات:', err);
  process.exit(1);
});
