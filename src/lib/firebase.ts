import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc } from 'firebase/firestore';
import { getMissingFirebaseConfig } from '../utils/firebaseConfig';

/**
 * Official Firebase Web Client Configuration
 * Target Project: fc-founoun
 *
 * NOTE: Only public client parameters are used.
 * No Firebase Admin SDK, private service account keys, or secrets are exposed in the client code.
 */
// Firebase Web API key from the official FC-FOUNOUN-WEB app configuration.
// This is a public client identifier, not a server-side secret.
const rawApiKey = 'AIzaSyDOBegB2Z2T3rYoHtU4K2QnHdft6kguzRA';

const firebaseConfig = {
  apiKey: rawApiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'fc-founoun.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || 'fc-founoun').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

const missingFirebaseConfig = getMissingFirebaseConfig(firebaseConfig);

// Initialize Firebase App safely (singleton pattern)
let app: FirebaseApp;
if (getApps().length > 0) {
  app = getApp();
} else {
  app = initializeApp(firebaseConfig);
}

// Safely initialize Auth instance
let authInstance: Auth;
try {
  authInstance = getAuth(app);
} catch (error) {
  console.warn('Firebase Auth initialization warning:', error);
  authInstance = getAuth(app);
}

export const auth: Auth = authInstance;

// Safely initialize Firestore instance
let dbInstance: Firestore;
try {
  dbInstance = getFirestore(app);
} catch (error) {
  console.warn('Firestore initialization warning:', error);
  dbInstance = getFirestore(app);
}

export const db: Firestore = dbInstance;

// Check if a real custom API key is configured
export const isFirebaseConfigured = (): boolean => {
  return missingFirebaseConfig.length === 0 && firebaseConfig.projectId === 'fc-founoun';
};

export const getFirebaseConfigurationError = (): string | null => {
  if (isFirebaseConfigured()) return null;
  return `إعداد Firebase غير مكتمل لمشروع fc-founoun. القيم الناقصة أو غير الصالحة: ${missingFirebaseConfig.join(', ')}. أضفها إلى متغيرات VITE_* ثم أعد بناء التطبيق.`;
};

/**
 * User Profile Interface stored in Firestore: users/{uid}
 */
export interface UserProfile {
  uid: string;
  email: string;
  role: 'super_admin' | string;
  status: 'active' | string;
  displayName?: string;
  shift?: 'day' | 'night';
  createdAt?: unknown;
}

/**
 * Verifies that the authenticated user has super_admin role and active status in Firestore.
 * Path: users/{uid}
 *
 * Rules:
 * 1. Document must exist.
 * 2. role === "super_admin"
 * 3. status === "active"
 *
 * Throws descriptive errors if any requirement fails.
 */
export async function verifySuperAdmin(uid: string): Promise<UserProfile> {
  const userDocRef = doc(db, 'users', uid);
  const docSnap = await getDoc(userDocRef);

  if (!docSnap.exists()) {
    throw new Error('NO_DOCUMENT');
  }

  const data = docSnap.data();

  if (!data) {
    throw new Error('NO_DOCUMENT');
  }

  if (data.role !== 'super_admin') {
    throw new Error('UNAUTHORIZED_ROLE');
  }

  if (data.status !== 'active') {
    throw new Error('INACTIVE_ACCOUNT');
  }

  return {
    uid,
    email: data.email || '',
    role: data.role,
    status: data.status,
    displayName: data.displayName || 'المسؤول الرئيسي',
    createdAt: data.createdAt,
  };
}


/**
 * Verifies that an authenticated management account is active.
 * Both admin and super_admin may use the management workspace;
 * super_admin-only actions must be checked separately by the backend.
 */
export async function verifyAdmin(uid: string): Promise<UserProfile> {
  const userDocRef = doc(db, 'users', uid);
  const docSnap = await getDoc(userDocRef);
  if (!docSnap.exists()) throw new Error('NO_DOCUMENT');
  const data = docSnap.data();
  if (!data || !['admin', 'super_admin', 'responsible'].includes(data.role)) {
    throw new Error('UNAUTHORIZED_ROLE');
  }
  if (data.status !== 'active') throw new Error('INACTIVE_ACCOUNT');
  return {
    uid,
    email: data.email || '',
    role: data.role,
    status: data.status,
    displayName: data.displayName || (data.role === 'super_admin' ? 'المشرف العام' : data.role === 'responsible' ? 'المسؤول' : 'المدير العام'),
    ...(data.shift === 'day' || data.shift === 'night' ? { shift: data.shift } : {}),
    createdAt: data.createdAt,
  };
}

/**
 * Maps Firebase Auth error codes to user-friendly Arabic error messages.
 * Does NOT expose sensitive security information.
 */
export function mapAuthErrorToArabic(errorCode: string): string {
  if (
    errorCode.includes('api-key') ||
    errorCode.includes('invalid-api-key') ||
    errorCode.includes('api-key-not-valid')
  ) {
    return 'مفتاح API الخاص بـ Firebase لمشروع fc-founoun غير صالح أو لم يتم ضبطه بعد في المتغيرات البيئية (VITE_FIREBASE_API_KEY).';
  }

  switch (errorCode) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'بيانات تسجيل الدخول غير صحيحة. يرجى التحقق من صحة البريد الإلكتروني وكلمة المرور.';

    case 'auth/user-disabled':
      return 'تم تعطيل حساب المسؤول هذا. يرجى التواصل مع إدارة النظام.';

    case 'auth/too-many-requests':
      return 'تم تجميد المحاولات مؤقتاً بسبب تكرار إدخال بيانات غير صحيحة. يرجى الانتظار قليلاً ثم إعادة المحاولة.';

    case 'auth/network-request-failed':
      return 'تعذر الاتصال بخدمة المصادقة. يرجى التأكد من اتصالك بالإنترنت والمحاولة مجدداً.';

    case 'auth/operation-not-allowed':
      return 'طريقة تسجيل الدخول بالبريد الإلكتروني وكلمة المرور غير مفعّلة في لوحة تحكم Firebase لمشروع fc-founoun.';

    default:
      return 'حدث خطأ أثناء محاولة تسجيل الدخول. يرجى التحقق من الاتصال والمحاولة مرة أخرى.';
  }
}

/**
 * Maps Firestore and authorization errors to clear Arabic messages.
 */
export function mapAuthorizationErrorToArabic(errorCodeOrMessage: string): string {
  if (errorCodeOrMessage === 'NO_DOCUMENT') {
    return 'لا يوجد ملف تعريف مسجل لهذا الحساب في قاعدة البيانات (users/{uid}). الحساب غير مخوّل وتم تسجيل الخروج فوراً.';
  }
  if (errorCodeOrMessage === 'UNAUTHORIZED_ROLE') {
    return 'هذا الحساب لا يملك صلاحية المسؤول الرئيسي (super_admin). تم رفض الدخول وتسجيل الخروج فوراً.';
  }
  if (errorCodeOrMessage === 'INACTIVE_ACCOUNT') {
    return 'حساب المسؤول غير مفعّل (الحالة ليست active). تم إلغاء الوصول وتسجيل الخروج فوراً.';
  }

  // Firestore standard errors
  if (errorCodeOrMessage.includes('permission-denied') || errorCodeOrMessage.includes('PERMISSION_DENIED')) {
    return 'تم رفض الإذن بالقراءة من Firestore (قواعد الأمان لا تسمح بالوصول أو الصلاحيات مقيدة). تم تسجيل الخروج فوراً لدواعي الأمان.';
  }
  if (errorCodeOrMessage.includes('unavailable') || errorCodeOrMessage.includes('UNAVAILABLE')) {
    return 'خدمة قاعدة بيانات Firestore غير متاحة حالياً أو هناك انقطاع في الاتصال بالشبكة.';
  }

  return 'فشل التحقق من صلاحيات المسؤول في قاعدة البيانات. تم إلغاء الجلسة تلقائياً لدواعي الأمان.';
}
