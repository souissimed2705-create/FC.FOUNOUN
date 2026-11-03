/**
 * FC.FOUNOUN – Luxury Footwear
 * Models API Client
 *
 * Interfaces with the Cloudflare Worker backend for all mutating operations
 * (Create, Update, Delete) with Firebase ID Token authentication and RBAC.
 */

import { auth } from './firebase';
import type {
  CreateModelPayload,
  UpdateModelPayload,
  CreateModelResponse,
  UpdateModelResponse,
  DeleteModelResponse,
} from '../types/models';

const WORKER_BASE_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://shiny-bird-56fc.souissimed2705.workers.dev';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Retrieves the current user's Firebase ID token.
 * Automatically forces refresh if token has expired.
 */
async function getAuthToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new ApiError('المستخدم غير مسجل الدخول، يرجى تسجيل الدخول أولاً.', 401, 'unauthenticated');
  }
  try {
    return await currentUser.getIdToken(false);
  } catch (err) {
    throw new ApiError(
      `فشل الحصول على رمز المصادقة (ID Token): ${err instanceof Error ? err.message : 'خطأ غير معروف'}`,
      401,
      'token_fetch_failed'
    );
  }
}

/**
 * Maps Worker/HTTP status codes to clear Arabic messages.
 */
function mapStatusToMessage(status: number, fallback?: string): string {
  if (fallback && typeof fallback === 'string' && fallback.trim()) {
    return fallback;
  }
  switch (status) {
    case 400:
      return 'البيانات المرسلة غير صالحة أو ناقصة.';
    case 401:
      return 'انتهت صلاحية جلسة المصادقة أو أن الرمز غير صالح. يرجى إعادة تسجيل الدخول.';
    case 403:
      return 'ليس لديك صلاحية المدير العام (super_admin) لتنفيذ هذا الإجراء.';
    case 404:
      return 'الموديل المطلوب غير موجود أو تم حذفه مسبقاً.';
    case 409:
      return 'اسم الموديل محجوز مسبقاً لموديل آخر. يرجى اختيار اسم فريد.';
    case 413:
      return 'حجم البيانات أو الصور يتجاوز الحد الأقصى المسموح به.';
    case 500:
    case 502:
    case 503:
      return 'حدث خطأ في الخادم أثناء معالجة الطلب. يرجى المحاولة لاحقاً.';
    default:
      return `حدث خطأ غير متوقع (${status})`;
  }
}

/**
 * Creates a new footwear model atomically via Cloudflare Worker.
 * Returns unified response: { success: true, id, model, message }
 */
export async function createShoeModel(payload: CreateModelPayload): Promise<CreateModelResponse> {
  const token = await getAuthToken();

  const response = await fetch(`${WORKER_BASE_URL}/api/models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const responseData = await response.json().catch(() => null);

  if (!response.ok || !responseData?.success) {
    const errorMsg = responseData?.error || responseData?.message;
    const finalMsg = mapStatusToMessage(response.status, errorMsg);
    throw new ApiError(finalMsg, response.status, responseData?.code);
  }

  return responseData as CreateModelResponse;
}

/**
 * Updates an existing footwear model atomically via Cloudflare Worker.
 * Returns unified response: { success: true, id, model, message }
 */
export async function updateShoeModel(
  modelId: string,
  payload: UpdateModelPayload
): Promise<UpdateModelResponse> {
  if (!modelId) {
    throw new ApiError('معرّف الموديل مطلوب لتنفيذ التعديل.', 400, 'missing_id');
  }

  const token = await getAuthToken();

  const response = await fetch(`${WORKER_BASE_URL}/api/models/${encodeURIComponent(modelId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const responseData = await response.json().catch(() => null);

  if (!response.ok || !responseData?.success) {
    const errorMsg = responseData?.error || responseData?.message;
    const finalMsg = mapStatusToMessage(response.status, errorMsg);
    throw new ApiError(finalMsg, response.status, responseData?.code);
  }

  return responseData as UpdateModelResponse;
}

/**
 * Deletes an existing footwear model and frees its name reservation atomically.
 * Returns unified response: { success: true, id, message }
 */
export async function deleteShoeModel(modelId: string): Promise<DeleteModelResponse> {
  if (!modelId) {
    throw new ApiError('معرّف الموديل مطلوب لتنفيذ الحذف.', 400, 'missing_id');
  }

  const token = await getAuthToken();

  const response = await fetch(`${WORKER_BASE_URL}/api/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const responseData = await response.json().catch(() => null);

  if (!response.ok || !responseData?.success) {
    const errorMsg = responseData?.error || responseData?.message;
    const finalMsg = mapStatusToMessage(response.status, errorMsg);
    throw new ApiError(finalMsg, response.status, responseData?.code);
  }

  return responseData as DeleteModelResponse;
}
