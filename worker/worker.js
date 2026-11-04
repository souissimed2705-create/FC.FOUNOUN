/**
 * FC.FOUNOUN – Luxury Footwear
 * Cloudflare Worker Backend for Footwear Models Management
 *
 * Worker URL: https://shiny-bird-56fc.souissimed2705.workers.dev
 *
 * Security & Technical Review Implementations:
 * 1. Strict JWT Header & Claims Verification:
 *    - Validates header.typ strictly equals 'JWT'.
 *    - Validates header.alg strictly equals 'RS256' and non-empty kid.
 *    - Requires exp > nowSec (strictly in future).
 *    - Requires valid positive integer iat (not in future beyond clock skew tolerance of 300s).
 *    - Requires valid positive integer auth_time:
 *      * auth_time <= iat (authentication cannot happen after token issuance)
 *      * auth_time <= nowSec + 300 (cannot be in future beyond clock skew margin)
 *      * auth_time <= exp
 * 2. Strict Google Public JWK Verification:
 *    - Mandatory kty === 'RSA'
 *    - Mandatory use === 'sig'
 *    - Mandatory alg === 'RS256'
 *    - Mandatory kid matching header.kid
 *    - Strict Base64URL structure verification for modulus 'n' and exponent 'e'.
 * 3. Safe URI Component Decoding:
 *    - Safe decode of model ID with try/catch returning HTTP 400 on malformed URI sequences.
 * 4. Strict Single-Segment API Routing:
 *    - POST /api/models
 *    - PUT /api/models/:id (where :id matches /^[a-zA-Z0-9_-]{3,64}$/)
 *    - DELETE /api/models/:id
 *    - Rejects nested sub-paths with 404.
 * 5. Locked-down CORS Whitelist with Vary: Origin.
 * 6. Atomic Firestore Transactions for Create, Update, Delete with strict lock preconditions.
 */

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1/projects';
const MAX_REQUEST_BODY_BYTES = 900 * 1024; // 900 KB hard streaming abort ceiling
const MAX_IMAGE_CHARS = 320000; // Full Data URL length ceiling per image (including MIME prefix)
const MAX_COMBINED_CHARS = 600000; // Combined Data URL length ceiling
const MAX_JWT_CHARS = 4096; // Maximum acceptable ID Token length
const MODEL_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const CLOCK_SKEW_SEC = 300; // 5 minutes tolerance for clock drift

// In-memory cache for Cloudflare Worker instance
let jwksCache = { keys: null, expiresAt: 0 };
let serviceAccountTokenCache = { token: null, expiresAt: 0 };

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const isAllowed = isOriginAllowed(origin, env);

    // 1. CORS Preflight Handling
    if (request.method === 'OPTIONS') {
      return handleCorsPreflight(request, env, isAllowed);
    }

    // CORS Headers for Response
    const corsHeaders = getCorsHeaders(origin, isAllowed);

    // Reject disallowed cross-origin requests
    if (origin && !isAllowed) {
      return jsonResponse(
        { success: false, error: 'المصدر غير مسموح به عبر سياسة CORS الخاصة بالخادم', code: 'cors_forbidden' },
        403,
        corsHeaders
      );
    }

    const url = new URL(request.url);
    const cleanPath = url.pathname.replace(/\/+$/, '') || '/';

    // 2. Strict API Path Routing
    const managementRoute = parseManagementRoute(cleanPath, request.method);
    const workerLoginRoute = cleanPath === '/api/worker-auth/login' && request.method === 'POST';
    const managementLoginRoute = cleanPath === '/api/management-auth/login' && request.method === 'POST';
    const managementAccountsRoute = cleanPath === '/api/management-accounts' && ['GET', 'POST'].includes(request.method);
    const managementAccountMatch = cleanPath.match(/^\/api\/management-accounts\/([^/]+)(?:\/(code))?$/);
    const managementAccountActionRoute = managementAccountMatch && ((managementAccountMatch[2] && request.method === 'PUT') || (!managementAccountMatch[2] && ['PUT', 'DELETE'].includes(request.method)));
    const workerTasksRoute = cleanPath === '/api/worker/tasks' && request.method === 'GET';
    const workerProgressMatch = cleanPath.match(/^\/api\/worker\/tasks\/([^/]+)\/progress$/);
    const workerProgressRoute = workerProgressMatch && request.method === 'POST';
    const workerTaskStatusMatch = cleanPath.match(/^\/api\/worker\/tasks\/([^/]+)\/status$/);
    const workerTaskStatusRoute = workerTaskStatusMatch && request.method === 'PUT';
    const workerMessagesRoute = false; // Legacy shared worker-admin chat is disabled; use participant-only direct messages.
    const adminMessagesRoute = false;
    const contactsRoute = cleanPath === '/api/contacts' && request.method === 'GET';
    const directMessagesMatch = cleanPath.match(/^\/api\/direct-messages\/([^/]+)$/);
    const directMessagesRoute = directMessagesMatch && ['GET', 'POST'].includes(request.method);
    const workerCyclesRoute = cleanPath === '/api/worker/cycles' && ['GET', 'POST'].includes(request.method);
    const managementCyclesRoute = cleanPath === '/api/cycles' && request.method === 'GET';
    const cyclePhotoMatch = cleanPath.match(/^\/api\/cycles\/([^/]+)\/photo$/);
    const managementCyclePhotoRoute = cyclePhotoMatch && request.method === 'GET';
    if (managementRoute?.error) {
      return jsonResponse({ success: false, error: managementRoute.error.message, code: managementRoute.error.code }, 400, corsHeaders);
    }
    if (!managementRoute && !workerLoginRoute && !managementLoginRoute && !managementAccountsRoute && !managementAccountActionRoute && !workerTasksRoute && !workerProgressRoute && !workerTaskStatusRoute && !workerMessagesRoute && !contactsRoute && !directMessagesRoute && !workerCyclesRoute && !managementCyclesRoute && !managementCyclePhotoRoute && !adminMessagesRoute && !cleanPath.startsWith('/api/models')) {
      return jsonResponse({ success: false, error: 'المسار المطلوب غير موجود', code: 'not_found' }, 404, corsHeaders);
    }

    let modelIdParam = null;
    const modelsPrefix = '/api/models';

    if (managementRoute || workerLoginRoute || managementLoginRoute || managementAccountsRoute || managementAccountActionRoute || workerTasksRoute || workerProgressRoute || workerTaskStatusRoute || workerMessagesRoute || contactsRoute || directMessagesRoute || workerCyclesRoute || managementCyclesRoute || managementCyclePhotoRoute || adminMessagesRoute) {
      // Validated API routes are dispatched after authentication.
    } else if (cleanPath === modelsPrefix) {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse(
          { success: false, error: 'طريقة الطلب غير مدعومة لهذا المسار، استخدم GET للعرض أو POST لإنشاء موديل', code: 'method_not_allowed' },
          405,
          corsHeaders
        );
      }
    } else if (cleanPath.startsWith(`${modelsPrefix}/`)) {
      const remainder = cleanPath.slice(modelsPrefix.length + 1);

      // Disallow nested subpaths
      if (remainder.includes('/')) {
        return jsonResponse(
          { success: false, error: 'المسار الفرعي غير موجود أو غير مدعوم', code: 'not_found' },
          404,
          corsHeaders
        );
      }

      // Safe decode of URI component: returns HTTP 400 if malformed
      try {
        modelIdParam = safeDecodeUriSegment(remainder);
      } catch (err) {
        return jsonResponse(
          { success: false, error: err.message || 'معرّف الموديل مشوّه وغير صالح في المسار', code: err.code || 'malformed_uri' },
          400,
          corsHeaders
        );
      }

      if (!MODEL_ID_REGEX.test(modelIdParam)) {
        return jsonResponse(
          { success: false, error: 'معرّف الموديل في المسار غير صالح (يجب أن يتكون من 3 إلى 64 حرفاً)', code: 'invalid_model_id' },
          400,
          corsHeaders
        );
      }

      if (request.method !== 'PUT' && request.method !== 'DELETE') {
        return jsonResponse(
          { success: false, error: 'طريقة الطلب غير مدعومة لهذا المسار، استخدم PUT أو DELETE', code: 'method_not_allowed' },
          405,
          corsHeaders
        );
      }
    } else {
      return jsonResponse({ success: false, error: 'المسار المطلوب غير موجود', code: 'not_found' }, 404, corsHeaders);
    }

    try {
      // 3. Authenticate Firebase ID Token
      const serviceAccount = parseServiceAccount(env);
      const projectId = env.PROJECT_ID || serviceAccount.project_id || 'fc-founoun';
      if (workerLoginRoute || managementLoginRoute) {
        const saAccessToken = await getServiceAccountAccessToken(serviceAccount);
        if (workerLoginRoute) return await handleWorkerLogin(request, env, projectId, saAccessToken, corsHeaders);
        return await handleManagementLogin(request, env, projectId, saAccessToken, corsHeaders);
      }

      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse(
          { success: false, error: 'رمز المصادقة مفقود أو غير صالح. يرجى تسجيل الدخول كمدير عام.', code: 'unauthorized' },
          401,
          corsHeaders
        );
      }

      const idToken = authHeader.slice(7).trim();
      const decodedToken = await verifyFirebaseIdToken(idToken, projectId);
      const callerUid = decodedToken.sub;

      const saAccessToken = await getServiceAccountAccessToken(serviceAccount);
      if (contactsRoute || directMessagesRoute) {
        let callerRole;
        if (decodedToken.role === 'worker' && decodedToken.workerId === callerUid) {
          const workerDoc = await getFirestoreDoc(projectId, saAccessToken, `workers/${callerUid}`);
          if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') throw createHttpError('حساب مشرف العمال غير نشط', 403, 'worker_inactive');
          callerRole = 'worker';
        } else {
          callerRole = await verifyManagementRole(callerUid, projectId, saAccessToken);
        }
        if (contactsRoute) return await handleListContacts(callerUid, projectId, saAccessToken, corsHeaders);
        return await handleDirectMessages(request, safeDecodeUriSegment(directMessagesMatch[1]), callerUid, callerRole, projectId, saAccessToken, corsHeaders);
      }
      if (workerTasksRoute || workerProgressRoute || workerTaskStatusRoute || workerMessagesRoute || workerCyclesRoute) {
        if (decodedToken.role !== 'worker' || decodedToken.workerId !== callerUid) {
          throw createHttpError('هذه الخدمة مخصصة لحساب مشرف العمال فقط', 403, 'worker_only');
        }
        const activeWorkerDoc = await getFirestoreDoc(projectId, saAccessToken, `workers/${callerUid}`);
        if (!activeWorkerDoc || convertFromFirestoreFields(activeWorkerDoc.fields || {}).status !== 'active') {
          throw createHttpError('تم تجميد حساب مشرف العمال أو تعطيله', 403, 'worker_inactive');
        }
        if (workerTasksRoute) return await handleWorkerListTasks(callerUid, projectId, saAccessToken, corsHeaders);
        if (workerMessagesRoute) return await handleWorkerMessages(request, callerUid, projectId, saAccessToken, corsHeaders);
        if (workerCyclesRoute) return await handleWorkerCycles(request, callerUid, projectId, saAccessToken, corsHeaders);
        if (workerTaskStatusRoute) return await handleWorkerTaskStatus(request, safeDecodeUriSegment(workerTaskStatusMatch[1]), callerUid, projectId, saAccessToken, corsHeaders);
        const taskId = safeDecodeUriSegment(workerProgressMatch[1]);
        return await handleWorkerTaskProgress(request, taskId, callerUid, projectId, saAccessToken, corsHeaders);
      }
      if (decodedToken.role === 'worker') {
        if (request.method === 'GET' && cleanPath.startsWith('/api/models')) {
          const workerDoc = await getFirestoreDoc(projectId, saAccessToken, `workers/${callerUid}`);
          if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') throw createHttpError('حساب مشرف العمال غير نشط', 403, 'worker_inactive');
          return await handleListModels(request, projectId, saAccessToken, corsHeaders);
        }
        throw createHttpError('حساب مشرف العمال لا يملك صلاحيات الإدارة', 403, 'worker_admin_forbidden');
      }
      // 4. Verify Super Admin RBAC via Firestore
      const callerRole = await verifyManagementRole(callerUid, projectId, saAccessToken);
      if (managementRoute?.resource === 'workers') {
        assertWorkerManagementPermission(callerRole, request.method, managementRoute.action);
      }
      if (managementRoute?.resource === 'tasks') {
        assertTaskManagementPermission(callerRole);
      }
      
      if (managementAccountsRoute || managementAccountActionRoute) {
        assertSuperAdminManagementAccountsPermission(callerRole);
        if (managementAccountsRoute && request.method === 'GET') return await handleListManagementAccounts(projectId, saAccessToken, corsHeaders);
        if (managementAccountsRoute && request.method === 'POST') return await handleCreateManagementAccount(request, callerUid, projectId, saAccessToken, corsHeaders);
        const accountId = safeDecodeUriSegment(managementAccountMatch[1]);
        if (!/^mgr_[a-f0-9]{32}$/.test(accountId)) throw createHttpError('معرّف الحساب غير صالح', 400, 'invalid_management_account_id');
        if (managementAccountMatch[2] === 'code') return await handleSetManagementCode(request, accountId, callerUid, projectId, saAccessToken, corsHeaders);
        if (request.method === 'DELETE') return await handleFreezeManagementAccount(accountId, callerUid, projectId, saAccessToken, corsHeaders);
        return await handleUpdateManagementAccount(request, accountId, callerUid, projectId, saAccessToken, corsHeaders);
      }
      if (adminMessagesRoute) return await handleManagementMessages(request, callerUid, callerRole, projectId, saAccessToken, corsHeaders);
      if (managementCyclesRoute) return await handleListCycles(request, projectId, saAccessToken, corsHeaders);
      if (managementCyclePhotoRoute) return await handleCyclePhoto(safeDecodeUriSegment(cyclePhotoMatch[1]), projectId, saAccessToken, corsHeaders);

      // 5. Dispatch Route Handlers
      if (managementRoute) {
        return await dispatchManagementRoute(request, managementRoute, callerUid, callerRole, projectId, saAccessToken, corsHeaders);
      }

      if (request.method === 'GET') {
        return await handleListModels(request, projectId, saAccessToken, corsHeaders);
      }

      if (request.method === 'POST') {
        return await handleCreateModel(request, callerUid, projectId, saAccessToken, corsHeaders);
      }

      if (request.method === 'PUT') {
        return await handleUpdateModel(request, modelIdParam, callerUid, projectId, saAccessToken, corsHeaders);
      }

      if (request.method === 'DELETE') {
        return await handleDeleteModel(modelIdParam, callerUid, projectId, saAccessToken, corsHeaders);
      }

      return jsonResponse({ success: false, error: 'طريقة الطلب غير مدعومة', code: 'method_not_allowed' }, 405, corsHeaders);
    } catch (err) {
      console.error('[Worker Error]:', err);
      const status = typeof err.status === 'number' ? err.status : 500;
      const message = err.message || 'حدث خطأ داخلي في خادم Worker';
      const code = err.code || 'internal_server_error';
      return jsonResponse({ success: false, error: message, code }, status, corsHeaders);
    }
  },
};

// ==========================================
// ROUTE HANDLERS
// ==========================================

const RESOURCE_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

function parseManagementRoute(path, method) {
  const match = path.match(/^\/api\/(workers|tasks)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (!match) return null;
  const resource = match[1];
  let id = null;
  try {
    id = match[2] ? safeDecodeUriSegment(match[2]) : null;
  } catch (err) {
    return { error: err };
  }
  if (id && !RESOURCE_ID_REGEX.test(id)) {
    return { error: createHttpError('معرّف المورد في المسار غير صالح', 400, 'invalid_resource_id') };
  }
  const suffix = match[3] || null;
  if (suffix && (resource !== 'workers' || suffix !== 'pin' || method !== 'PUT')) {
    return null;
  }
  if (resource === 'workers') {
    if (!id && !['GET', 'POST'].includes(method)) return null;
    if (id && !suffix && !['PUT', 'DELETE'].includes(method)) return null;
  } else {
    if (!id && !['GET', 'POST', 'PUT'].includes(method)) return null;
    if (id && !suffix && method !== 'PUT') return null;
    if (id && suffix !== 'progress') return null;
  }
  return { resource, id, action: suffix };
}

async function dispatchManagementRoute(request, route, callerUid, callerRole, projectId, accessToken, corsHeaders) {
  if (route.resource === 'workers' && route.action === 'pin') {
    return handleSetWorkerPin(request, route.id, callerUid, projectId, accessToken, corsHeaders);
  }
  if (route.resource === 'workers') {
    if (request.method === 'GET') return handleListResource(request, 'workers', projectId, accessToken, corsHeaders, callerRole);
    if (request.method === 'POST') return handleCreateResource(request, 'workers', callerUid, projectId, accessToken, corsHeaders, callerRole);
    if (request.method === 'PUT') return handleUpdateResource(request, 'workers', route.id, callerUid, projectId, accessToken, corsHeaders, callerRole);
    return handleDeleteResource(route.id, 'workers', projectId, accessToken, corsHeaders);
  }
  if (route.action === 'progress') {
    return handleTaskProgress(request, route.id, callerUid, projectId, accessToken, corsHeaders);
  }
  if (request.method === 'GET') return handleListResource(request, 'tasks', projectId, accessToken, corsHeaders);
  if (request.method === 'POST') return handleCreateResource(request, 'tasks', callerUid, projectId, accessToken, corsHeaders);
  if (!route.id) return handleUpdateTaskCollection(request, callerUid, projectId, accessToken, corsHeaders);
  return handleUpdateResource(request, 'tasks', route.id, callerUid, projectId, accessToken, corsHeaders);
}

const RESOURCE_FIELDS = {
  workers: ['name', 'phone', 'email', 'status', 'notes', 'machineNumber', 'shift'],
  tasks: ['title', 'description', 'status', 'priority', 'assignedWorkerId', 'assignedWorkerName', 'machineNumber', 'shift', 'modelId', 'modelName', 'modelCategory', 'targetQuantity', 'completedQuantity', 'dueDate'],
};

function validateResourcePayload(payload, resource, isCreate) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError('محتوى الطلب يجب أن يكون كائناً JSON', 400, 'invalid_payload');
  }
  const fields = RESOURCE_FIELDS[resource];
  const unknown = Object.keys(payload).filter((key) => !fields.includes(key));
  if (unknown.length) throw createHttpError(`حقول غير مسموحة: ${unknown.join(', ')}`, 400, 'unknown_field');
  if (isCreate) {
    const required = resource === 'workers' ? 'name' : 'title';
    if (typeof payload[required] !== 'string' || !payload[required].trim()) {
      throw createHttpError(`الحقل ${required} إلزامي`, 400, 'missing_required_field');
    }
    if (resource === 'tasks') {
      if (typeof payload.assignedWorkerId !== 'string' || !payload.assignedWorkerId.trim()) {
        throw createHttpError('العامل المسؤول عن المهمة إلزامي', 400, 'missing_worker');
      }
      if (typeof payload.modelId !== 'string' || !RESOURCE_ID_REGEX.test(payload.modelId)) {
        throw createHttpError('اختيار مودال موجود إلزامي قبل إصدار أمر الإنتاج', 400, 'missing_model');
      }
      if (!Number.isSafeInteger(payload.targetQuantity) || payload.targetQuantity < 1) {
        throw createHttpError('الكمية المطلوبة يجب أن تكون عدداً صحيحاً موجباً', 400, 'invalid_target_quantity');
      }
    }
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 2000)) {
      throw createHttpError(`قيمة الحقل ${key} غير صالحة`, 400, 'invalid_field');
    }
  }
  if (resource === 'workers') {
    if (payload.name !== undefined && (typeof payload.name !== 'string' || !payload.name.trim())) {
      throw createHttpError('اسم العامل لا يمكن أن يكون فارغاً', 400, 'invalid_worker_name');
    }
    if (payload.status !== undefined && !['active', 'inactive'].includes(payload.status)) {
      throw createHttpError('حالة العامل يجب أن تكون active أو inactive فقط', 400, 'invalid_worker_status');
    }
    if (payload.phone !== undefined && typeof payload.phone !== 'string') {
      throw createHttpError('رقم هاتف العامل غير صالح', 400, 'invalid_worker_phone');
    }
    if (payload.machineNumber !== undefined && ![1, 2, 3].includes(payload.machineNumber)) {
      throw createHttpError('رقم المكينة يجب أن يكون 1 أو 2 أو 3', 400, 'invalid_machine_number');
    }
    if (payload.shift !== undefined && !['day', 'night'].includes(payload.shift)) {
      throw createHttpError('الوردية يجب أن تكون نهارية أو ليلية', 400, 'invalid_shift');
    }
    if ((payload.machineNumber === undefined) !== (payload.shift === undefined)) {
      throw createHttpError('يجب تحديد المكينة والوردية معاً', 400, 'incomplete_machine_assignment');
    }
  }
}

async function parseJsonBody(request, maxBytes = 64 * 1024) {
  let payload;
  try { payload = JSON.parse(await readStreamWithLimit(request.body, maxBytes)); }
  catch (err) {
    if (err?.code === 'payload_too_large') throw err;
    throw createHttpError('محتوى الطلب ليس بتنسيق JSON صالح', 400, 'invalid_json');
  }
  return payload;
}

async function handleListResource(request, resource, projectId, accessToken, corsHeaders, callerRole = 'super_admin') {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('pageSize') || '50');
  const pageSize = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
  const result = await listAllFirestoreDocs(projectId, accessToken, resource, 100, 500);
  const records = result.documents.map((doc) => sanitizeResourceOutput(convertFromFirestoreFields(doc.fields || {}), resource));
  const visibleRecords = resource === 'workers' && callerRole === 'responsible'
    ? records.map(worker => ({ id: worker.id, name: worker.name, status: worker.status, machineNumber: worker.machineNumber, shift: worker.shift }))
    : records;
  return jsonResponse({ success: true, [resource]: visibleRecords, nextPageToken: result.nextPageToken }, 200, corsHeaders);
}

async function handleCreateResource(request, resource, callerUid, projectId, accessToken, corsHeaders, callerRole = 'super_admin') {
  if (resource === 'tasks') assertTaskCreationFieldsAllowed(await parseJsonBody(request.clone()));
  const payload = await parseJsonBody(request);
  validateResourcePayload(payload, resource, true);
  if (resource === 'workers') assertResponsibleWorkerFieldsAllowed(callerRole, payload);
  if (resource === 'workers') {
    const existingWorkers = await listAllFirestoreDocs(projectId, accessToken, 'workers', 100, 500);
    const duplicateName = existingWorkers.documents.map(doc => convertFromFirestoreFields(doc.fields || {})).some(worker => worker.status === 'active' && String(worker.name || '').trim().toLocaleLowerCase() === payload.name.trim().toLocaleLowerCase());
    if (duplicateName) throw createHttpError('اسم مشرف العمال مستخدم بالفعل؛ اختر اسماً مميزاً لتسجيل الدخول به', 409, 'worker_name_taken');
    if (![1, 2, 3].includes(payload.machineNumber) || !['day', 'night'].includes(payload.shift)) throw createHttpError('يجب تعيين كل مشرف عمال إلى مكينة ووردية محددتين', 400, 'worker_assignment_required');
    if (payload.status !== 'inactive') {
      const occupied = existingWorkers.documents.map(doc => convertFromFirestoreFields(doc.fields || {}))
        .some(worker => worker.status === 'active' && worker.machineNumber === payload.machineNumber && worker.shift === payload.shift);
      if (occupied) throw createHttpError('هذه المكينة والوردية مرتبطتان بالفعل بمشرف عمال نشط', 409, 'machine_shift_already_assigned');
    }
  }
  const id = `${resource === 'workers' ? 'wkr' : 'tsk'}_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const defaults = resource === 'workers' ? { status: 'active' } : { status: 'open', completedQuantity: 0 };
  let taskDetails = {};
  if (resource === 'tasks') {
    const assignedWorkerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${payload.assignedWorkerId}`);
    if (!assignedWorkerDoc) throw createHttpError('العامل المحدد غير موجود', 404, 'worker_not_found');
    const assignedWorker = convertFromFirestoreFields(assignedWorkerDoc.fields || {});
    if (assignedWorker.status !== 'active') throw createHttpError('لا يمكن إسناد مهمة إلى عامل غير نشط', 409, 'worker_inactive');
    const modelDoc = await getFirestoreDoc(projectId, accessToken, `models/${payload.modelId}`);
    if (!modelDoc) throw createHttpError('المودال المحدد غير موجود في الكتالوج', 404, 'model_not_found');
    const model = convertFromFirestoreFields(modelDoc.fields || {});
    if (![1, 2, 3].includes(assignedWorker.machineNumber) || !['day', 'night'].includes(assignedWorker.shift)) throw createHttpError('حساب مشرف العمال غير مربوط بمكينة ووردية', 409, 'worker_machine_assignment_missing');
    taskDetails = { assignedWorkerName: assignedWorker.name, machineNumber: assignedWorker.machineNumber, shift: assignedWorker.shift, modelId: payload.modelId, modelName: model.name, modelCategory: model.category };
  }
  const record = { id, ...defaults, ...payload, ...taskDetails, createdBy: callerUid, createdAt: now, updatedAt: now };
  const writes = [{ update: { name: `projects/${projectId}/databases/(default)/documents/${resource}/${id}`, fields: convertToFirestoreFields(record) }, currentDocument: { exists: false } }];
  if (resource === 'workers' && record.status === 'active') {
    const slotPath = workerMachineSlotPath(record.machineNumber, record.shift);
    const slotDoc = await getFirestoreDoc(projectId, accessToken, slotPath);
    writes.push(buildWorkerMachineReservationWrite(projectId, id, record.machineNumber, record.shift, slotDoc, true));
  }
  await commitFirestoreTransaction(projectId, accessToken, null, writes);
  return jsonResponse({ success: true, [resource === 'workers' ? 'worker' : 'task']: record }, 201, corsHeaders);
}

async function handleUpdateResource(request, resource, id, callerUid, projectId, accessToken, corsHeaders, callerRole = null) {
  const payload = await parseJsonBody(request);
  validateResourcePayload(payload, resource, false);
  if (resource === 'workers') assertResponsibleWorkerFieldsAllowed(callerRole, payload);
  const currentDoc = await getFirestoreDoc(projectId, accessToken, `${resource}/${id}`);
  if (!currentDoc) throw createHttpError('المورد المطلوب غير موجود', 404, 'resource_not_found');
  const current = convertFromFirestoreFields(currentDoc.fields || {});
  const changes = { ...payload };

  if (resource === 'workers' && changes.name !== undefined && (changes.status ?? current.status) === 'active') {
    const existingWorkers = await listAllFirestoreDocs(projectId, accessToken, 'workers', 100, 500);
    const duplicateName = existingWorkers.documents.map(doc => convertFromFirestoreFields(doc.fields || {})).some(worker => worker.id !== id && worker.status === 'active' && String(worker.name || '').trim().toLocaleLowerCase() === changes.name.trim().toLocaleLowerCase());
    if (duplicateName) throw createHttpError('اسم مشرف العمال مستخدم بالفعل؛ اختر اسماً مميزاً لتسجيل الدخول به', 409, 'worker_name_taken');
  }
  if (resource === 'workers' && (changes.machineNumber !== undefined || changes.shift !== undefined || changes.status === 'active')) {
    const targetMachine = changes.machineNumber ?? current.machineNumber;
    const targetShift = changes.shift ?? current.shift;
    if (![1, 2, 3].includes(targetMachine) || !['day', 'night'].includes(targetShift)) throw createHttpError('يجب تعيين المكينة والوردية معاً', 400, 'worker_assignment_required');
  }

  if (resource === 'tasks') {
    if (Object.prototype.hasOwnProperty.call(changes, 'completedQuantity')) {
      throw createHttpError('لا يمكن تعديل الكمية المنجزة مباشرة؛ تُسجّل عبر سجل الإنجاز فقط', 400, 'completed_quantity_read_only');
    }
    if (changes.targetQuantity !== undefined &&
      (!Number.isSafeInteger(changes.targetQuantity) || changes.targetQuantity < Math.max(1, Number(current.completedQuantity || 0)))) {
      throw createHttpError('الكمية المطلوبة لا يمكن أن تقل عن الكمية المنجزة بالفعل', 400, 'invalid_target_quantity');
    }
    // These display fields are always resolved by the server, never trusted from the browser.
    delete changes.modelName;
    delete changes.modelCategory;
    delete changes.assignedWorkerName;

    if (changes.assignedWorkerId !== undefined) {
      if (typeof changes.assignedWorkerId !== 'string' || !RESOURCE_ID_REGEX.test(changes.assignedWorkerId)) {
        throw createHttpError('معرّف العامل غير صالح', 400, 'invalid_worker_id');
      }
      const assignedWorkerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${changes.assignedWorkerId}`);
      if (!assignedWorkerDoc) throw createHttpError('العامل المحدد غير موجود', 404, 'worker_not_found');
      const assignedWorker = convertFromFirestoreFields(assignedWorkerDoc.fields || {});
      if (assignedWorker.status !== 'active') throw createHttpError('لا يمكن إسناد المهمة إلى عامل غير نشط', 409, 'worker_inactive');
      if (![1, 2, 3].includes(assignedWorker.machineNumber) || !['day', 'night'].includes(assignedWorker.shift)) throw createHttpError('حساب مشرف العمال غير مربوط بمكينة ووردية', 409, 'worker_machine_assignment_missing');
      changes.assignedWorkerName = assignedWorker.name;
      changes.machineNumber = assignedWorker.machineNumber;
      changes.shift = assignedWorker.shift;
    }
    if (changes.assignedWorkerId === undefined && (changes.machineNumber !== undefined || changes.shift !== undefined)) {
      throw createHttpError('المكينة والوردية تؤخذان تلقائياً من حساب مشرف العمال', 400, 'machine_assignment_read_only');
    }
    if (changes.modelId !== undefined) {
      if (typeof changes.modelId !== 'string' || !RESOURCE_ID_REGEX.test(changes.modelId)) {
        throw createHttpError('معرّف المودال غير صالح', 400, 'invalid_model_id');
      }
      const modelDoc = await getFirestoreDoc(projectId, accessToken, `models/${changes.modelId}`);
      if (!modelDoc) throw createHttpError('المودال المحدد غير موجود في الكتالوج', 404, 'model_not_found');
      const model = convertFromFirestoreFields(modelDoc.fields || {});
      changes.modelName = model.name;
      changes.modelCategory = model.category;
      changes.title = `إنتاج مودال ${model.name}`;
    }
  }

  const record = { ...current, ...changes, updatedBy: callerUid, updatedAt: new Date().toISOString() };
  const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${resource}/${id}`, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: currentDoc.updateTime } };
  const writes = [write];
  if (resource === 'workers') {
    const willBeActive = record.status === 'active';
    const oldAssignmentValid = [1, 2, 3].includes(current.machineNumber) && ['day', 'night'].includes(current.shift);
    const newAssignmentValid = [1, 2, 3].includes(record.machineNumber) && ['day', 'night'].includes(record.shift);
    if (willBeActive && !newAssignmentValid) throw createHttpError('يجب تعيين المكينة والوردية قبل تفعيل الحساب', 400, 'worker_assignment_required');
    if (willBeActive) {
      const targetPath = workerMachineSlotPath(record.machineNumber, record.shift);
      const targetSlot = await getFirestoreDoc(projectId, accessToken, targetPath);
      if (!targetSlot || convertFromFirestoreFields(targetSlot.fields || {}).status !== 'active') {
        const allWorkers = await listAllFirestoreDocs(projectId, accessToken, 'workers', 100, 500);
        const occupiedLegacy = allWorkers.documents.map(doc => convertFromFirestoreFields(doc.fields || {}))
          .some(worker => worker.id !== id && worker.status === 'active' && worker.machineNumber === record.machineNumber && worker.shift === record.shift);
        if (occupiedLegacy) throw createHttpError('هذه المكينة والوردية مرتبطتان بالفعل بمشرف عمال نشط', 409, 'machine_shift_already_assigned');
      }
      writes.push(buildWorkerMachineReservationWrite(projectId, id, record.machineNumber, record.shift, targetSlot, true));
    }
    const assignmentChanged = oldAssignmentValid &&
      (current.machineNumber !== record.machineNumber || current.shift !== record.shift);
    if ((!willBeActive || assignmentChanged) && oldAssignmentValid) {
      const oldPath = workerMachineSlotPath(current.machineNumber, current.shift);
      const oldSlot = await getFirestoreDoc(projectId, accessToken, oldPath);
      const release = buildWorkerMachineReservationWrite(projectId, id, current.machineNumber, current.shift, oldSlot, false);
      if (release) writes.push(release);
    }
  }
  await commitFirestoreTransaction(projectId, accessToken, null, writes);
  return jsonResponse({ success: true, [resource === 'workers' ? 'worker' : 'task']: sanitizeResourceOutput(record, resource) }, 200, corsHeaders);
}

async function handleUpdateTaskCollection(request, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  if (!payload || typeof payload.id !== 'string' || !RESOURCE_ID_REGEX.test(payload.id)) {
    throw createHttpError('حقل id الصالح إلزامي عند استخدام PUT /api/tasks', 400, 'missing_task_id');
  }
  const { id, ...changes } = payload;
  const syntheticRequest = new Request(request.url, { method: 'PUT', body: JSON.stringify(changes) });
  return handleUpdateResource(syntheticRequest, 'tasks', id, callerUid, projectId, accessToken, corsHeaders);
}

/** @param {string} role @param {string} method @param {string | null} [action=null] */
export function assertTaskCreationFieldsAllowed(payload) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'completedQuantity')) {
    throw createHttpError('الكمية المنجزة تبدأ من صفر وتُسجّل عبر سجل الإنجاز فقط', 400, 'completed_quantity_read_only');
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'status')) {
    throw createHttpError('تبدأ المهمة بالحالة الجديدة؛ لا يمكن فرض حالتها عند الإنشاء', 400, 'invalid_initial_task_status');
  }
  return true;
}

export function assertResponsibleWorkerFieldsAllowed(role, payload) {
  if (role !== 'responsible') return true;
  const allowed = ['name', 'machineNumber', 'shift', 'status'];
  const forbidden = Object.keys(payload || {}).filter(key => !allowed.includes(key));
  if (forbidden.length) {
    throw createHttpError('المسؤول لا يستطيع إدخال أو تعديل بيانات العامل خارج الاسم والمكينة والوردية والحالة', 403, 'responsible_worker_field_forbidden');
  }
  return true;
}

/**
 * @param {string} role
 * @param {string} method
 * @param {string | null} [action=null]
 */
export function assertWorkerManagementPermission(role, method, action = null) {
  if (role === 'super_admin') return true;
  if (role === 'admin' && ['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return true;
  if (role === 'responsible' && ['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return true;
  throw createHttpError('لا تملك صلاحية تنفيذ هذه العملية على حسابات مشرفي العمال', 403, 'worker_management_forbidden');
}

/** @param {string} role */
export function assertTaskManagementPermission(role) {
  if (role === 'super_admin' || role === 'admin') return true;
  throw createHttpError('إدارة مهام الإنتاج من صلاحيات المدير العام والمشرف العام فقط', 403, 'task_management_forbidden');
}

export function assertSuperAdminManagementAccountsPermission(role) {
  if (role === 'super_admin') return true;
  throw createHttpError('إدارة حسابات المديرين والمسؤولين من صلاحيات المشرف العام فقط', 403, 'super_admin_only_management_accounts');
}

/** @param {{role:string,status?:string,shift?:string}} current
 * @param {{status?:string,shift?:string}} changes
 * @param {Array<{uid?:string,id?:string,role?:string,status?:string,shift?:string}>} accounts
 * @param {string} targetUid
 * @param {string} callerUid
 */
export function assertManagementAccountUpdateAllowed(current, changes, accounts, targetUid, callerUid) {
  if (targetUid === callerUid && changes.status === 'inactive') {
    throw createHttpError('لا يمكن للمشرف العام تجميد حسابه بنفسه', 403, 'cannot_freeze_self');
  }
  const nextStatus = changes.status ?? current.status;
  const nextShift = changes.shift ?? current.shift;
  if (current.role === 'responsible' && nextStatus === 'active' &&
      accounts.some(user => (user.uid || user.id) !== targetUid &&
        user.role === 'responsible' && user.status === 'active' && user.shift === nextShift)) {
    throw createHttpError('توجد بالفعل حساب مسؤول نشط لهذه الوردية', 409, 'responsible_shift_taken');
  }
  return true;
}

/** Build an optimistic-concurrency reservation write for one responsible shift. */
export function buildResponsibleShiftReservationWrite(projectId, uid, shift, slotDoc, active) {
  if (!['day', 'night'].includes(shift)) throw createHttpError('الوردية غير صالحة', 400, 'invalid_responsible_shift');
  const existing = slotDoc ? convertFromFirestoreFields(slotDoc.fields || {}) : null;
  if (!active) {
    if (!existing || existing.uid !== uid || existing.status !== 'active') return null;
  } else if (existing && existing.status === 'active' && existing.uid !== uid) {
    throw createHttpError('هذه الوردية محجوزة لمسؤول آخر', 409, 'responsible_shift_taken');
  }
  const record = { uid, shift, status: active ? 'active' : 'inactive', updatedAt: new Date().toISOString() };
  const write = {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/management_responsible_slots/${shift}`,
      fields: convertToFirestoreFields(record)
    }
  };
  write.currentDocument = slotDoc?.updateTime ? { updateTime: slotDoc.updateTime } : { exists: false };
  return write;
}

export function workerMachineSlotPath(machineNumber, shift) {
  if (![1, 2, 3].includes(machineNumber) || !['day', 'night'].includes(shift)) {
    throw createHttpError('تعيين المكينة أو الوردية غير صالح', 400, 'worker_assignment_required');
  }
  return `worker_machine_slots/m${machineNumber}_${shift}`;
}

export function buildWorkerMachineReservationWrite(projectId, workerId, machineNumber, shift, slotDoc, active) {
  const path = workerMachineSlotPath(machineNumber, shift);
  const existing = slotDoc ? convertFromFirestoreFields(slotDoc.fields || {}) : null;
  if (!active && (!existing || existing.workerId !== workerId || existing.status !== 'active')) return null;
  if (active && existing && existing.status === 'active' && existing.workerId !== workerId) {
    throw createHttpError('هذه المكينة والوردية محجوزتان لمشرف عمال آخر', 409, 'machine_shift_already_assigned');
  }
  const record = { workerId, machineNumber, shift, status: active ? 'active' : 'inactive', updatedAt: new Date().toISOString() };
  const write = {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/${path}`,
      fields: convertToFirestoreFields(record)
    }
  };
  write.currentDocument = slotDoc?.updateTime ? { updateTime: slotDoc.updateTime } : { exists: false };
  return write;
}

export function buildWorkerFreezeUpdate(current, timestamp) {
  return { ...current, status: 'inactive', frozenAt: timestamp, updatedAt: timestamp };
}

async function handleDeleteResource(id, resource, projectId, accessToken, corsHeaders) {
  const current = await getFirestoreDoc(projectId, accessToken, `${resource}/${id}`);
  if (!current) throw createHttpError('المورد المطلوب غير موجود', 404, 'resource_not_found');
  // Worker records are never permanently deleted: the legacy DELETE route freezes the account.
  if (resource === 'workers') {
    const existing = convertFromFirestoreFields(current.fields || {});
    const timestamp = new Date().toISOString();
    const frozen = buildWorkerFreezeUpdate(existing, timestamp);
    const writes = [{
      update: {
        name: `projects/${projectId}/databases/(default)/documents/workers/${id}`,
        fields: convertToFirestoreFields(frozen)
      },
      currentDocument: { updateTime: current.updateTime }
    }];
    if ([1, 2, 3].includes(existing.machineNumber) && ['day', 'night'].includes(existing.shift)) {
      const slot = await getFirestoreDoc(projectId, accessToken, workerMachineSlotPath(existing.machineNumber, existing.shift));
      const release = buildWorkerMachineReservationWrite(projectId, id, existing.machineNumber, existing.shift, slot, false);
      if (release) writes.push(release);
    }
    await commitFirestoreTransaction(projectId, accessToken, null, writes);
    return jsonResponse({ success: true, id, status: 'inactive', frozen: true }, 200, corsHeaders);
  }
  throw createHttpError('الحذف الدائم غير مسموح لهذا المورد', 405, 'permanent_delete_forbidden');
}



async function handleListManagementAccounts(projectId, accessToken, corsHeaders) {
  const result = await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500);
  const accounts = result.documents.map(doc => ({ ...convertFromFirestoreFields(doc.fields || {}), uid: doc.name?.split('/').pop() }))
    .filter(user => ['admin', 'responsible'].includes(user.role))
    .map(user => ({ uid: user.uid, displayName: user.displayName || user.name || '', role: user.role, status: user.status, shift: user.shift || null, createdAt: user.createdAt || null }));
  return jsonResponse({ success: true, data: accounts }, 200, corsHeaders);
}

async function handleCreateManagementAccount(request, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const role = payload?.role;
  const code = typeof payload?.code === 'string' ? payload.code : '';
  const shift = payload?.shift;
  if (!name || name.length > 80 || !['admin', 'responsible'].includes(role) || !/^\d{6}$/.test(code)) {
    throw createHttpError('أدخل الاسم ونوع الحساب والكود السري المكوّن من 6 أرقام', 400, 'invalid_management_account');
  }
  if (role === 'responsible' && !['day', 'night'].includes(shift)) throw createHttpError('يجب تحديد وردية المسؤول: نهار أو ليل', 400, 'responsible_shift_required');
  if (role === 'admin' && shift !== undefined) throw createHttpError('حساب المدير العام لا يحتاج إلى وردية', 400, 'unexpected_shift');
  const result = await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500);
  const accounts = result.documents.map(doc => convertFromFirestoreFields(doc.fields || {})).filter(user => user.role === role);
  if (accounts.some(user => String(user.displayName || user.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw createHttpError('يوجد حساب من النوع نفسه بهذا الاسم بالفعل', 409, 'management_name_taken');
  }
  if (role === 'responsible') {
    const activeAccounts = accounts.filter(user => user.status === 'active');
    if (activeAccounts.length >= 2) throw createHttpError('يوجد حسابا مسؤول نشطان بالفعل؛ واحد للنهار وآخر لليل', 409, 'responsible_accounts_limit');
    if (activeAccounts.some(user => user.shift === shift)) throw createHttpError('يوجد بالفعل حساب مسؤول مخصص لهذه الوردية', 409, 'responsible_shift_taken');
  }
  const uid = `mgr_${crypto.randomUUID().replace(/-/g, '')}`;
  const reservationWrites = [];
  if (role === 'responsible') {
    const slotDoc = await getFirestoreDoc(projectId, accessToken, `management_responsible_slots/${shift}`);
    reservationWrites.push(buildResponsibleShiftReservationWrite(projectId, uid, shift, slotDoc, true));
  }
  const now = new Date().toISOString();
  const user = { uid, displayName: name, name, email: '', role, status: 'active', ...(role === 'responsible' ? { shift } : {}), createdBy: callerUid, createdAt: now, updatedAt: now };
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const pinHash = await computePinPbkdf2(salt, code);
  const codeRecord = { uid, pin_hash: pinHash, pin_salt: salt, pin_algo: 'pbkdf2-sha256-v1', updatedBy: callerUid, updatedAt: now };
  await commitFirestoreTransaction(projectId, accessToken, null, [
    { update: { name: `projects/${projectId}/databases/(default)/documents/users/${uid}`, fields: convertToFirestoreFields(user) }, currentDocument: { exists: false } },
    { update: { name: `projects/${projectId}/databases/(default)/documents/management_codes/${uid}`, fields: convertToFirestoreFields(codeRecord) }, currentDocument: { exists: false } },
    ...reservationWrites
  ]);
  return jsonResponse({ success: true, data: { uid, displayName: name, role, status: 'active', shift: shift || null } }, 201, corsHeaders);
}

async function handleSetManagementCode(request, uid, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  if (!payload || typeof payload.code !== 'string' || !/^\d{6}$/.test(payload.code)) throw createHttpError('الكود السري يجب أن يتكون من 6 أرقام', 400, 'invalid_management_code');
  const userDoc = await getFirestoreDoc(projectId, accessToken, `users/${uid}`);
  if (!userDoc) throw createHttpError('الحساب غير موجود', 404, 'management_account_not_found');
  const user = convertFromFirestoreFields(userDoc.fields || {});
  if (!['admin', 'responsible'].includes(user.role)) throw createHttpError('نوع الحساب غير مدعوم', 400, 'invalid_management_role');
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const pinHash = await computePinPbkdf2(salt, payload.code);
  const path = `management_codes/${uid}`;
  const old = await getFirestoreDoc(projectId, accessToken, path);
  const record = { uid, pin_hash: pinHash, pin_salt: salt, pin_algo: 'pbkdf2-sha256-v1', updatedBy: callerUid, updatedAt: new Date().toISOString() };
  const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: convertToFirestoreFields(record) } };
  write.currentDocument = old?.updateTime ? { updateTime: old.updateTime } : { exists: false };
  await commitFirestoreTransaction(projectId, accessToken, null, [write]);
  return jsonResponse({ success: true, uid, message: 'تم تحديث الكود السري.' }, 200, corsHeaders);
}

async function handleUpdateManagementAccount(request, uid, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  const allowed = ['name', 'shift', 'status'];
  if (!payload || typeof payload !== 'object' || Object.keys(payload).some(key => !allowed.includes(key))) throw createHttpError('حقول تعديل الحساب غير صالحة', 400, 'invalid_management_update');
  const doc = await getFirestoreDoc(projectId, accessToken, `users/${uid}`);
  if (!doc) throw createHttpError('الحساب غير موجود', 404, 'management_account_not_found');
  const current = convertFromFirestoreFields(doc.fields || {});
  if (!['admin', 'responsible'].includes(current.role)) throw createHttpError('نوع الحساب غير مدعوم', 400, 'invalid_management_role');
  const changes = {};
  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 80) throw createHttpError('اسم الحساب غير صالح', 400, 'invalid_management_name');
    const all = await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500);
    const duplicate = all.documents.map(d => ({ ...convertFromFirestoreFields(d.fields || {}), uid: d.name?.split('/').pop() }))
      .some(user => user.uid !== uid && user.role === current.role && String(user.displayName || user.name || '').trim().toLocaleLowerCase() === payload.name.trim().toLocaleLowerCase());
    if (duplicate) throw createHttpError('الاسم مستخدم في حساب آخر من النوع نفسه', 409, 'management_name_taken');
    changes.displayName = payload.name.trim(); changes.name = payload.name.trim();
  }
  if (payload.shift !== undefined) {
    if (current.role !== 'responsible' || !['day', 'night'].includes(payload.shift)) throw createHttpError('الوردية غير صالحة لهذا الحساب', 400, 'invalid_responsible_shift');
    const all = await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500);
    if (all.documents.map(d => ({ ...convertFromFirestoreFields(d.fields || {}), uid: d.name?.split('/').pop() })).some(user => user.uid !== uid && user.role === 'responsible' && user.status === 'active' && user.shift === payload.shift)) throw createHttpError('هذه الوردية مخصصة لحساب مسؤول آخر', 409, 'responsible_shift_taken');
    changes.shift = payload.shift;
  }
  if (payload.status !== undefined) {
    if (!['active', 'inactive'].includes(payload.status)) throw createHttpError('حالة الحساب غير صالحة', 400, 'invalid_management_status');
    changes.status = payload.status;
  }
  const allAccounts = (await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500)).documents
    .map(item => ({ ...convertFromFirestoreFields(item.fields || {}), uid: item.name?.split('/').pop() }));
  assertManagementAccountUpdateAllowed(current, changes, allAccounts, uid, callerUid);
  const record = { ...current, ...changes, updatedBy: callerUid, updatedAt: new Date().toISOString() };
  const writes = [{ update: { name: `projects/${projectId}/databases/(default)/documents/users/${uid}`, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: doc.updateTime } }];
  if (current.role === 'responsible') {
    const nextShift = record.shift || current.shift;
    const nextActive = record.status === 'active';
    const oldSlot = current.shift ? await getFirestoreDoc(projectId, accessToken, `management_responsible_slots/${current.shift}`) : null;
    if (nextActive) {
      const nextSlot = nextShift === current.shift ? oldSlot : await getFirestoreDoc(projectId, accessToken, `management_responsible_slots/${nextShift}`);
      writes.push(buildResponsibleShiftReservationWrite(projectId, uid, nextShift, nextSlot, true));
    }
    if (oldSlot && current.shift && (!nextActive || nextShift !== current.shift)) {
      const release = buildResponsibleShiftReservationWrite(projectId, uid, current.shift, oldSlot, false);
      if (release) writes.push(release);
    }
  }
  await commitFirestoreTransaction(projectId, accessToken, null, writes);
  return jsonResponse({ success: true, data: { uid, displayName: record.displayName, role: record.role, status: record.status, shift: record.shift || null } }, 200, corsHeaders);
}

async function handleFreezeManagementAccount(uid, callerUid, projectId, accessToken, corsHeaders) {
  const doc = await getFirestoreDoc(projectId, accessToken, `users/${uid}`);
  if (!doc) throw createHttpError('الحساب غير موجود', 404, 'management_account_not_found');
  const current = convertFromFirestoreFields(doc.fields || {});
  if (!['admin', 'responsible'].includes(current.role)) throw createHttpError('لا يمكن تجميد هذا النوع من الحسابات', 403, 'management_account_freeze_forbidden');
  assertManagementAccountUpdateAllowed(current, { status: 'inactive' }, [], uid, callerUid);
  const now = new Date().toISOString();
  const record = { ...current, status: 'inactive', frozenAt: now, updatedAt: now, updatedBy: callerUid };
  const writes = [{ update: { name: `projects/${projectId}/databases/(default)/documents/users/${uid}`, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: doc.updateTime } }];
  if (current.role === 'responsible' && current.shift) {
    const slotDoc = await getFirestoreDoc(projectId, accessToken, `management_responsible_slots/${current.shift}`);
    const release = buildResponsibleShiftReservationWrite(projectId, uid, current.shift, slotDoc, false);
    if (release) writes.push(release);
  }
  await commitFirestoreTransaction(projectId, accessToken, null, writes);
  return jsonResponse({ success: true, data: { uid, status: 'inactive', frozen: true } }, 200, corsHeaders);
}

async function handleManagementLogin(request, env, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const code = typeof payload?.code === 'string' ? payload.code : '';
  const role = payload?.role;
  if (!name || name.length > 100 || !/^\d{6}$/.test(code) || !['admin', 'responsible'].includes(role)) {
    throw createHttpError('أدخل الاسم والكود السري الصحيحين واختر نوع الحساب', 400, 'invalid_management_credentials');
  }
  const result = await listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500);
  const matches = result.documents.map(doc => ({ ...convertFromFirestoreFields(doc.fields || {}), uid: doc.name?.split('/').pop() }))
    .filter(user => user.role === role && user.status === 'active' && String(user.displayName || user.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase());
  if (matches.length !== 1) throw createHttpError('الاسم أو الكود السري غير صحيح', 401, 'invalid_management_credentials');
  const user = matches[0];
  const uid = user.uid;
  if (!uid) throw createHttpError('ملف الحساب غير مكتمل', 403, 'management_account_invalid');
  const codeDoc = await getFirestoreDoc(projectId, accessToken, `management_codes/${uid}`);
  if (!codeDoc) throw createHttpError('لم يعيّن المشرف العام كود دخول لهذا الحساب بعد', 403, 'management_code_missing');
  const codeRecord = convertFromFirestoreFields(codeDoc.fields || {});
  const attemptsPath = `management_auth_attempts/${uid}`;
  const attemptsDoc = await getFirestoreDoc(projectId, accessToken, attemptsPath);
  const attempts = attemptsDoc ? convertFromFirestoreFields(attemptsDoc.fields || {}) : {};
  const now = Date.now();
  if (Number(attempts.lockedUntil || 0) > now) throw createHttpError('تم إيقاف محاولة الدخول مؤقتاً. حاول بعد 15 دقيقة.', 429, 'management_login_locked');
  const suppliedHash = codeRecord.pin_algo === 'pbkdf2-sha256-v1'
    ? await computePinPbkdf2(codeRecord.pin_salt, code)
    : await computeWebCryptoSha256(`${codeRecord.pin_salt}:${code}`);
  if (suppliedHash !== codeRecord.pin_hash) {
    const count = Number(attempts.count || 0) + 1;
    const lockedUntil = count >= 5 ? now + 15 * 60 * 1000 : 0;
    const record = { uid, count: lockedUntil ? 0 : count, lockedUntil, updatedAt: new Date().toISOString() };
    const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${attemptsPath}`, fields: convertToFirestoreFields(record) } };
    write.currentDocument = attemptsDoc?.updateTime ? { updateTime: attemptsDoc.updateTime } : { exists: false };
    await commitFirestoreTransaction(projectId, accessToken, null, [write]);
    throw createHttpError('الاسم أو الكود السري غير صحيح', 401, 'invalid_management_credentials');
  }
  const reset = { uid, count: 0, lockedUntil: 0, updatedAt: new Date().toISOString() };
  const resetWrite = { update: { name: `projects/${projectId}/databases/(default)/documents/${attemptsPath}`, fields: convertToFirestoreFields(reset) } };
  resetWrite.currentDocument = attemptsDoc?.updateTime ? { updateTime: attemptsDoc.updateTime } : { exists: false };
  await commitFirestoreTransaction(projectId, accessToken, null, [resetWrite]);
  const displayName = String(user.displayName || user.name || name);
  const customToken = await createFirebaseCustomToken(env, uid, displayName, role);
  return jsonResponse({ success: true, customToken, user: { uid, displayName, role } }, 200, corsHeaders);
}

async function handleWorkerLogin(request, env, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  const workerName = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const pin = typeof payload?.pin === 'string' ? payload.pin : '';
  if (!workerName || workerName.length > 100 || !/^\d{6}$/.test(pin)) {
    throw createHttpError('أدخل اسم مشرف العمال والكود السري المكوّن من 6 أرقام', 400, 'invalid_worker_credentials');
  }
  const workerList = await listAllFirestoreDocs(projectId, accessToken, 'workers', 100, 500);
  const matchingWorkers = workerList.documents.map(doc => ({ doc, worker: convertFromFirestoreFields(doc.fields || {}) }))
    .filter(item => item.worker.status === 'active' && String(item.worker.name || '').trim().toLocaleLowerCase() === workerName.toLocaleLowerCase());
  if (matchingWorkers.length !== 1) throw createHttpError('الاسم أو الكود السري غير صحيح، أو أن الاسم غير فريد', 401, 'invalid_worker_credentials');
  const workerId = matchingWorkers[0].worker.id;
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  const pinDoc = await getFirestoreDoc(projectId, accessToken, `worker_pins/${workerId}`);
  if (!workerDoc || !pinDoc) throw createHttpError('بيانات العامل أو PIN غير صحيحة', 401, 'invalid_worker_credentials');
  const worker = convertFromFirestoreFields(workerDoc.fields || {});
  const pinRecord = convertFromFirestoreFields(pinDoc.fields || {});
  if (worker.status !== 'active') throw createHttpError('حساب العامل غير نشط', 403, 'worker_inactive');

  const attemptsPath = `worker_auth_attempts/${workerId}`;
  const attemptsDoc = await getFirestoreDoc(projectId, accessToken, attemptsPath);
  const attempts = attemptsDoc ? convertFromFirestoreFields(attemptsDoc.fields || {}) : {};
  const now = Date.now();
  if (Number(attempts.lockedUntil || 0) > now) {
    throw createHttpError('تم إيقاف محاولة الدخول مؤقتاً. حاول بعد 15 دقيقة.', 429, 'worker_login_locked');
  }

  const suppliedHash = pinRecord.pin_algo === 'pbkdf2-sha256-v1'
    ? await computePinPbkdf2(pinRecord.pin_salt, pin)
    : await computeWebCryptoSha256(`${pinRecord.pin_salt}:${pin}`);
  if (suppliedHash !== pinRecord.pin_hash) {
    const count = Number(attempts.count || 0) + 1;
    const lockedUntil = count >= 5 ? now + 15 * 60 * 1000 : 0;
    const attemptRecord = { workerId, count: lockedUntil ? 0 : count, lockedUntil, updatedAt: new Date().toISOString() };
    const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${attemptsPath}`, fields: convertToFirestoreFields(attemptRecord) } };
    if (attemptsDoc?.updateTime) write.currentDocument = { updateTime: attemptsDoc.updateTime };
    else write.currentDocument = { exists: false };
    await commitFirestoreTransaction(projectId, accessToken, null, [write]);
    throw createHttpError('بيانات العامل أو PIN غير صحيحة', 401, 'invalid_worker_credentials');
  }

  const resetWrite = { update: { name: `projects/${projectId}/databases/(default)/documents/${attemptsPath}`, fields: convertToFirestoreFields({ workerId, count: 0, lockedUntil: 0, updatedAt: new Date().toISOString() }) } };
  if (attemptsDoc?.updateTime) resetWrite.currentDocument = { updateTime: attemptsDoc.updateTime };
  else resetWrite.currentDocument = { exists: false };
  await commitFirestoreTransaction(projectId, accessToken, null, [resetWrite]);

  const customToken = await createFirebaseCustomToken(env, workerId, worker.name);
  return jsonResponse({ success: true, customToken, worker: { id: workerId, name: worker.name } }, 200, corsHeaders);
}

async function createFirebaseCustomToken(env, uid, workerName, role = 'worker') {
  const sa = parseServiceAccount(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: nowSec, exp: nowSec + 3600, uid,
    claims: { role, ...(role === 'worker' ? { workerId: uid } : {}), workerName: String(workerName || 'مستخدم').slice(0, 80) }
  })));
  const signingInput = `${header}.${payload}`;
  const key = await importPkcs8PrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function readConversation(workerId, projectId, accessToken) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'messages' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'workerId' },
            op: 'EQUAL',
            value: { stringValue: workerId }
          }
        },
        limit: 1000
      }
    })
  });
  if (!response.ok) throw createHttpError('تعذر تحميل رسائل المحادثة', 500, 'messages_read_failed');
  const rows = await response.json();
  return rows.filter(row => row.document).map(row => {
    const message = convertFromFirestoreFields(row.document.fields || {});
    message.id = message.id || String(row.document.name || '').split('/').pop();
    return message;
  }).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).slice(-100);
}

async function saveConversationMessage(workerId, senderUid, senderRole, senderName, text, projectId, accessToken) {
  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (!cleanText || cleanText.length > 2000) {
    throw createHttpError('اكتب رسالة لا تتجاوز 2000 حرف', 400, 'invalid_message');
  }
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') {
    throw createHttpError('العامل غير موجود أو حسابه غير نشط', 404, 'worker_not_found');
  }
  const id = `msg_${crypto.randomUUID().replace(/-/g, '')}`;
  const message = {
    id, workerId, senderUid, senderRole, senderName: String(senderName || 'مستخدم').slice(0, 100),
    text: cleanText, createdAt: new Date().toISOString()
  };
  const path = `messages/${id}`;
  await commitFirestoreTransaction(projectId, accessToken, null, [{
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: convertToFirestoreFields(message) },
    currentDocument: { exists: false }
  }]);
  return message;
}

async function handleManagementMessages(request, callerUid, callerRole, projectId, accessToken, corsHeaders) {
  if (request.method === 'GET') {
    const workerId = new URL(request.url).searchParams.get('workerId') || '';
    if (!RESOURCE_ID_REGEX.test(workerId)) throw createHttpError('اختر عاملاً صحيحاً لعرض المحادثة', 400, 'missing_worker');
    const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
    if (!workerDoc) throw createHttpError('العامل غير موجود', 404, 'worker_not_found');
    const messages = await readConversation(workerId, projectId, accessToken);
    return jsonResponse({ success: true, data: messages }, 200, corsHeaders);
  }
  const payload = await parseJsonBody(request);
  const workerId = typeof payload?.workerId === 'string' ? payload.workerId.trim() : '';
  if (!RESOURCE_ID_REGEX.test(workerId)) throw createHttpError('اختر عاملاً صحيحاً لإرسال الرسالة', 400, 'missing_worker');
  const userDoc = await getFirestoreDoc(projectId, accessToken, `users/${callerUid}`);
  const user = userDoc ? convertFromFirestoreFields(userDoc.fields || {}) : {};
  const message = await saveConversationMessage(workerId, callerUid, callerRole, user.displayName || user.email || 'المسؤول', payload.text, projectId, accessToken);
  return jsonResponse({ success: true, data: message }, 201, corsHeaders);
}

async function handleWorkerMessages(request, workerId, projectId, accessToken, corsHeaders) {
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') {
    throw createHttpError('حساب العامل غير نشط', 403, 'worker_inactive');
  }
  if (request.method === 'GET') {
    const messages = await readConversation(workerId, projectId, accessToken);
    return jsonResponse({ success: true, data: messages }, 200, corsHeaders);
  }
  const payload = await parseJsonBody(request);
  const worker = convertFromFirestoreFields(workerDoc.fields || {});
  const message = await saveConversationMessage(workerId, workerId, 'worker', worker.name || 'العامل', payload.text, projectId, accessToken);
  return jsonResponse({ success: true, data: message }, 201, corsHeaders);
}



async function getActiveContact(uid, projectId, accessToken) {
  const userDoc = await getFirestoreDoc(projectId, accessToken, `users/${uid}`);
  if (userDoc) {
    const user = convertFromFirestoreFields(userDoc.fields || {});
    if (user.status !== 'active' || !['super_admin', 'admin', 'responsible'].includes(user.role)) return null;
    return { uid, displayName: String(user.displayName || user.name || user.email || 'مستخدم').slice(0, 80), role: user.role, status: user.status };
  }
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${uid}`);
  if (workerDoc) {
    const worker = convertFromFirestoreFields(workerDoc.fields || {});
    if (worker.status !== 'active') return null;
    return { uid, displayName: String(worker.name || 'مشرف العمال').slice(0, 80), role: 'worker', status: worker.status };
  }
  return null;
}

export function isExactParticipantPair(participants, uidA, uidB) {
  return Array.isArray(participants) && participants.length === 2 && new Set(participants).size === 2 && participants.includes(uidA) && participants.includes(uidB);
}

async function buildDirectConversationId(uidA, uidB) {
  const pair = [uidA, uidB].sort();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pair.join(':')));
  return `conv_${bytesToBase64Url(new Uint8Array(digest))}`;
}

export function firestoreDocumentId(documentName) {
  if (typeof documentName !== 'string') return '';
  const parts = documentName.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

async function handleListContacts(callerUid, projectId, accessToken, corsHeaders) {
  const [usersResult, workersResult] = await Promise.all([
    listAllFirestoreDocs(projectId, accessToken, 'users', 100, 500),
    listAllFirestoreDocs(projectId, accessToken, 'workers', 100, 500)
  ]);
  // Firestore REST documents always carry their document path, even when
  // older profile records do not contain a duplicated uid/id field.
  const users = usersResult.documents.map(doc => {
    const user = convertFromFirestoreFields(doc.fields || {});
    return { ...user, uid: user.uid || user.id || firestoreDocumentId(doc.name) };
  })
    .filter(user => user.uid && user.uid !== callerUid && user.status === 'active' && ['super_admin', 'admin', 'responsible'].includes(user.role))
    .map(user => ({ uid: user.uid, name: String(user.displayName || user.name || 'مستخدم').slice(0, 80), role: user.role }));
  const workers = workersResult.documents.map(doc => {
    const worker = convertFromFirestoreFields(doc.fields || {});
    return { ...worker, uid: worker.id || worker.workerId || firestoreDocumentId(doc.name) };
  })
    .filter(worker => worker.uid && worker.uid !== callerUid && worker.status === 'active')
    .map(worker => ({ uid: worker.uid, name: String(worker.name || 'مشرف العمال').slice(0, 80), role: 'worker' }));
  const contacts = [...users, ...workers].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return jsonResponse({ success: true, data: contacts }, 200, corsHeaders);
}

async function readDirectConversation(conversationId, uidA, uidB, projectId, accessToken) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'messages' }],
        where: { fieldFilter: { field: { fieldPath: 'conversationId' }, op: 'EQUAL', value: { stringValue: conversationId } } },
        // Avoid requiring a composite Firestore index: retrieve a bounded history,
        // then sort the selected conversation locally by its server timestamp.
        limit: 1000
      }
    })
  });
  if (!response.ok) throw createHttpError('تعذر تحميل المحادثة الخاصة', 500, 'direct_messages_read_failed');
  const rows = await response.json();
  return rows.filter(row => row.document).map(row => {
    const message = convertFromFirestoreFields(row.document.fields || {});
    // Defense in depth: do not return any message whose own participant list
    // does not match the exact two users, even if its conversationId matches.
    if (!isExactParticipantPair(message.participants, uidA, uidB)) return null;
    message.id = message.id || firestoreDocumentId(row.document.name);
    return message;
  }).filter(Boolean).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function handleDirectMessages(request, otherUid, callerUid, callerRole, projectId, accessToken, corsHeaders) {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(otherUid) || otherUid === callerUid) throw createHttpError('اختر مستخدماً آخر صالحاً لبدء المحادثة', 400, 'invalid_direct_recipient');
  const [sender, recipient] = await Promise.all([
    getActiveContact(callerUid, projectId, accessToken),
    getActiveContact(otherUid, projectId, accessToken)
  ]);
  if (!sender) throw createHttpError('حسابك غير نشط أو غير موجود', 403, 'sender_inactive');
  if (!recipient) throw createHttpError('المستخدم المطلوب غير موجود أو غير نشط', 404, 'recipient_unavailable');
  const conversationId = await buildDirectConversationId(callerUid, otherUid);
  const conversationPath = `conversations/${conversationId}`;
  const conversationDoc = await getFirestoreDoc(projectId, accessToken, conversationPath);
  if (request.method === 'GET') {
    if (!conversationDoc) return jsonResponse({ success: true, data: [] }, 200, corsHeaders);
    const conversation = convertFromFirestoreFields(conversationDoc.fields || {});
    if (!isExactParticipantPair(conversation.participants, callerUid, otherUid)) {
      throw createHttpError('لا تملك صلاحية الاطلاع على هذه المحادثة', 403, 'direct_conversation_forbidden');
    }
    const messages = await readDirectConversation(conversationId, callerUid, otherUid, projectId, accessToken);
    return jsonResponse({ success: true, data: messages }, 200, corsHeaders);
  }
  const payload = await parseJsonBody(request);
  const cleanText = typeof payload?.text === 'string' ? payload.text.trim() : '';
  if (!cleanText || cleanText.length > 2000) throw createHttpError('اكتب رسالة لا تتجاوز 2000 حرف', 400, 'invalid_message');
  const now = new Date().toISOString();
  const messageId = `dm_${crypto.randomUUID().replace(/-/g, '')}`;
  const conversation = {
    id: conversationId,
    participants: [callerUid, otherUid].sort(),
    createdAt: conversationDoc ? convertFromFirestoreFields(conversationDoc.fields || {}).createdAt : now,
    updatedAt: now,
    lastMessageAt: now
  };
  const message = {
    id: messageId, conversationId, participants: conversation.participants,
    senderUid: callerUid, recipientUid: otherUid, senderRole: callerRole,
    senderName: sender.displayName, recipientName: recipient.displayName,
    text: cleanText, createdAt: now
  };
  const conversationWrite = { update: { name: `projects/${projectId}/databases/(default)/documents/${conversationPath}`, fields: convertToFirestoreFields(conversation) } };
  conversationWrite.currentDocument = conversationDoc?.updateTime ? { updateTime: conversationDoc.updateTime } : { exists: false };
  const messageWrite = { update: { name: `projects/${projectId}/databases/(default)/documents/messages/${messageId}`, fields: convertToFirestoreFields(message) }, currentDocument: { exists: false } };
  await commitFirestoreTransaction(projectId, accessToken, null, [conversationWrite, messageWrite]);
  return jsonResponse({ success: true, data: message }, 201, corsHeaders);
}

export function resolveCycleRecordedAt(clientRecordedAt, serverNow = new Date()) {
  if (clientRecordedAt === undefined || clientRecordedAt === null || clientRecordedAt === '') {
    return serverNow.toISOString();
  }
  if (typeof clientRecordedAt !== 'string') {
    throw createHttpError('وقت تسجيل التقرير غير صالح', 400, 'invalid_cycle_recorded_at');
  }
  const parsed = new Date(clientRecordedAt);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== clientRecordedAt) {
    throw createHttpError('وقت تسجيل التقرير غير صالح', 400, 'invalid_cycle_recorded_at');
  }
  if (parsed.getTime() > serverNow.getTime() + 5 * 60 * 1000) {
    throw createHttpError('وقت تسجيل التقرير لا يمكن أن يكون في المستقبل', 400, 'future_cycle_recorded_at');
  }
  return parsed.toISOString();
}

async function handleWorkerCycles(request, workerId, projectId, accessToken, corsHeaders) {
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc) throw createHttpError('حساب مشرف العمال غير موجود', 403, 'worker_inactive');
  const worker = convertFromFirestoreFields(workerDoc.fields || {});
  if (worker.status !== 'active') throw createHttpError('حساب مشرف العمال غير نشط', 403, 'worker_inactive');
  if (![1, 2, 3].includes(worker.machineNumber) || !['day', 'night'].includes(worker.shift)) {
    throw createHttpError('لم يحدد المشرف العام المكينة والوردية لهذا الحساب بعد', 409, 'machine_assignment_missing');
  }
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('pageSize') || '100');
    const pageSize = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 200) : 100;
    const pageToken = url.searchParams.get('pageToken') || null;
    const rows = await listFirestoreDocs(projectId, accessToken, 'machine_cycles', pageSize, pageToken, '__name__ desc', ['id', 'machineNumber', 'shift', 'date', 'count', 'workerId', 'workerName', 'recordedAt', 'receivedAt', 'hasPhoto']);
    const reports = rows.documents.map(doc => convertFromFirestoreFields(doc.fields || {}))
      .filter(item => item.workerId === workerId)
      .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))
      .map(report => ({ ...report, hasPhoto: report.hasPhoto !== false }));
    return jsonResponse({ success: true, data: reports, nextPageToken: rows.nextPageToken }, 200, corsHeaders);
  }
  const payload = await parseJsonBody(request, 700 * 1024);
  if (!Number.isSafeInteger(payload?.count) || payload.count < 0 || payload.count > 100000000) {
    throw createHttpError('عدد الدورات يجب أن يكون عدداً صحيحاً غير سالب', 400, 'invalid_cycle_count');
  }
  const photo = typeof payload.photo === 'string' ? payload.photo : '';
  if (!photo || photo.length > 480000 || !/^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) {
    throw createHttpError('صورة العداد غير صالحة أو حجمها كبير؛ أعد اختيار صورة مضغوطة', 400, 'invalid_counter_photo');
  }
  const receivedAt = new Date();
  const recordedAt = resolveCycleRecordedAt(payload.recordedAt, receivedAt);
  const dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(recordedAt));
  const datePart = Object.fromEntries(dateParts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const date = `${datePart.year}-${datePart.month}-${datePart.day}`;
  const shift = worker.shift;
  const machineNumber = worker.machineNumber;
  const id = `mc_${date.replace(/-/g, '')}_${machineNumber}_${shift}`;
  const path = `machine_cycles/${id}`;
  const existing = await getFirestoreDoc(projectId, accessToken, path);
  if (existing) {
    const previous = convertFromFirestoreFields(existing.fields || {});
    if (previous.workerId !== workerId) throw createHttpError('تم تسجيل تقرير هذه المكينة والوردية لهذا اليوم بواسطة حساب آخر', 409, 'cycle_report_exists');
  }
  const record = {
    id, machineNumber, shift, date, count: payload.count, photo, hasPhoto: true,
    workerId, workerName: String(worker.name || 'مشرف العمال').slice(0, 100),
    recordedAt, receivedAt: receivedAt.toISOString(), updatedAt: receivedAt.toISOString()
  };
  const write = {
    update: { name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: convertToFirestoreFields(record) },
    currentDocument: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false }
  };
  await commitFirestoreTransaction(projectId, accessToken, null, [write]);
  return jsonResponse({ success: true, data: { ...record, photo: undefined } }, existing ? 200 : 201, corsHeaders);
}


async function handleCyclePhoto(id, projectId, accessToken, corsHeaders) {
  if (!/^mc_[0-9]{8}_[123]_(?:day|night)$/.test(id)) throw createHttpError('معرّف تقرير الدورات غير صالح', 400, 'invalid_cycle_id');
  const doc = await getFirestoreDoc(projectId, accessToken, `machine_cycles/${id}`);
  if (!doc) throw createHttpError('تقرير الدورات غير موجود', 404, 'cycle_report_not_found');
  const record = convertFromFirestoreFields(doc.fields || {});
  if (typeof record.photo !== 'string' || !record.photo.startsWith('data:image/')) throw createHttpError('صورة العداد غير متوفرة', 404, 'cycle_photo_not_found');
  return jsonResponse({ success: true, data: { id, photo: record.photo } }, 200, corsHeaders);
}

async function handleListCycles(request, projectId, accessToken, corsHeaders) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('pageSize') || '100');
  const pageSize = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 200) : 100;
  const pageToken = url.searchParams.get('pageToken') || null;
  // Fetch a bounded page, newest machine-cycle reports first. The client can
  // request older pages without loading an ever-growing collection at once.
  const result = await listFirestoreDocs(projectId, accessToken, 'machine_cycles', pageSize, pageToken, '__name__ desc', ['id', 'machineNumber', 'shift', 'date', 'count', 'workerId', 'workerName', 'recordedAt', 'receivedAt', 'hasPhoto']);
  const data = result.documents.map(doc => convertFromFirestoreFields(doc.fields || {}))
    .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))
    .map(report => ({ ...report, hasPhoto: report.hasPhoto !== false }));
  return jsonResponse({ success: true, data, nextPageToken: result.nextPageToken }, 200, corsHeaders);
}

async function handleWorkerListTasks(workerId, projectId, accessToken, corsHeaders) {
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') {
    throw createHttpError('حساب العامل غير نشط', 403, 'worker_inactive');
  }
  const result = await listAllFirestoreDocs(projectId, accessToken, 'tasks', 100, 500);
  const tasks = result.documents
    .map(doc => convertFromFirestoreFields(doc.fields || {}))
    .filter(task => task.assignedWorkerId === workerId)
    .map(task => sanitizeResourceOutput(task, 'tasks'));
  return jsonResponse({ success: true, tasks }, 200, corsHeaders);
}

async function handleWorkerTaskStatus(request, taskId, workerId, projectId, accessToken, corsHeaders) {
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') {
    throw createHttpError('حساب العامل غير نشط', 403, 'worker_inactive');
  }
  const payload = await parseJsonBody(request);
  if (!payload || !['pending', 'in_progress'].includes(payload.status)) {
    throw createHttpError('يمكن للعامل تعليق المهمة أو استئنافها فقط', 400, 'invalid_task_status');
  }
  const taskDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
  if (!taskDoc) throw createHttpError('المهمة المطلوبة غير موجودة', 404, 'task_not_found');
  const task = convertFromFirestoreFields(taskDoc.fields || {});
  if (task.assignedWorkerId !== workerId) {
    throw createHttpError('لا يمكنك تغيير حالة مهمة غير مسندة إليك', 403, 'task_not_assigned');
  }
  if (['completed', 'cancelled'].includes(task.status) || Number(task.completedQuantity || 0) >= Number(task.targetQuantity || 0)) {
    throw createHttpError('لا يمكن تغيير حالة مهمة مكتملة أو ملغاة', 409, 'task_not_changeable');
  }
  const now = new Date().toISOString();
  const record = { ...task, status: payload.status, updatedBy: workerId, updatedAt: now };
  await commitFirestoreTransaction(projectId, accessToken, null, [{
    update: {
      name: `projects/${projectId}/databases/(default)/documents/tasks/${taskId}`,
      fields: convertToFirestoreFields(record)
    },
    currentDocument: { updateTime: taskDoc.updateTime }
  }]);
  return jsonResponse({ success: true, task: sanitizeResourceOutput(record, 'tasks') }, 200, corsHeaders);
}

async function handleWorkerTaskProgress(request, taskId, workerId, projectId, accessToken, corsHeaders) {
  const workerDoc = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!workerDoc || convertFromFirestoreFields(workerDoc.fields || {}).status !== 'active') {
    throw createHttpError('حساب العامل غير نشط', 403, 'worker_inactive');
  }
  const taskDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
  if (!taskDoc) throw createHttpError('المهمة غير موجودة', 404, 'task_not_found');
  const task = convertFromFirestoreFields(taskDoc.fields || {});
  if (task.assignedWorkerId !== workerId) throw createHttpError('لا يمكنك تحديث مهمة غير مسندة إليك', 403, 'task_not_assigned');
  if (task.status === 'cancelled' || task.status === 'completed') throw createHttpError('هذه المهمة مغلقة', 409, 'task_closed');
  return handleTaskProgress(request, taskId, workerId, projectId, accessToken, corsHeaders, workerId);
}

async function handleSetWorkerPin(request, workerId, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  if (!payload || typeof payload.pin !== 'string' || !/^\d{6}$/.test(payload.pin)) {
    throw createHttpError('PIN يجب أن يتكون من 6 أرقام بالضبط', 400, 'invalid_pin');
  }
  const worker = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!worker) throw createHttpError('العامل المطلوب غير موجود', 404, 'worker_not_found');
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const pinHash = await computePinPbkdf2(salt, payload.pin);
  const pinRecord = { workerId, pin_hash: pinHash, pin_salt: salt, pin_algo: 'pbkdf2-sha256-v1', updatedBy: callerUid, updatedAt: new Date().toISOString() };
  const pinPath = `worker_pins/${workerId}`;
  const existingPinDoc = await getFirestoreDoc(projectId, accessToken, pinPath);
  const pinWrite = {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/${pinPath}`,
      fields: convertToFirestoreFields(pinRecord)
    },
    currentDocument: existingPinDoc?.updateTime
      ? { updateTime: existingPinDoc.updateTime }
      : { exists: false }
  };
  await commitFirestoreTransaction(projectId, accessToken, null, [pinWrite]);
  return jsonResponse({ success: true, workerId, message: 'تم حفظ PIN بشكل hash فقط' }, 200, corsHeaders);
}

async function handleTaskProgress(request, taskId, callerUid, projectId, accessToken, corsHeaders, expectedWorkerId = null) {
  const payload = await parseJsonBody(request);
  if (!payload || !Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 1000000) {
    throw createHttpError('quantity يجب أن يكون عدداً صحيحاً موجباً', 400, 'invalid_quantity');
  }
  if (payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length > 2000)) {
    throw createHttpError('ملاحظة الإنجاز غير صالحة', 400, 'invalid_note');
  }
  if (typeof payload.clientMutationId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(payload.clientMutationId)) {
    throw createHttpError('معرّف عملية الإنجاز غير صالح', 400, 'invalid_mutation_id');
  }

  const mutationPath = `task_progress/${payload.clientMutationId}`;
  const previousMutation = await getFirestoreDoc(projectId, accessToken, mutationPath);
  if (previousMutation) {
    const previous = convertFromFirestoreFields(previousMutation.fields || {});
    if (previous.taskId !== taskId || previous.quantity !== payload.quantity) {
      throw createHttpError('معرّف العملية مستخدم لعملية إنجاز مختلفة', 409, 'mutation_id_conflict');
    }
    if (previous.createdBy !== callerUid) {
      throw createHttpError('لا يمكنك إعادة استخدام معرّف إنجاز تابع لمستخدم آخر', 403, 'mutation_owner_mismatch');
    }
    const latestDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
    if (!latestDoc) throw createHttpError('المهمة المطلوبة غير موجودة', 404, 'task_not_found');
    const latestRecord = convertFromFirestoreFields(latestDoc.fields || {});
    if (expectedWorkerId && latestRecord.assignedWorkerId !== expectedWorkerId) {
      throw createHttpError('لا يمكنك الاطلاع على مهمة غير مسندة إليك', 403, 'task_not_assigned');
    }
    const latest = sanitizeResourceOutput(latestRecord, 'tasks');
    return jsonResponse({ success: true, task: latest, duplicate: true }, 200, corsHeaders);
  }

  const currentDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
  if (!currentDoc) throw createHttpError('المهمة المطلوبة غير موجودة', 404, 'task_not_found');
  const current = convertFromFirestoreFields(currentDoc.fields || {});
  if (expectedWorkerId && current.assignedWorkerId !== expectedWorkerId) {
    throw createHttpError('لا يمكنك تحديث مهمة غير مسندة إليك', 403, 'task_not_assigned');
  }
  if (expectedWorkerId && current.status === 'pending') {
    throw createHttpError('هذه المهمة معلّقة؛ استأنفها أولاً قبل تسجيل الإنجاز', 409, 'task_is_paused');
  }
  if (['completed', 'cancelled'].includes(current.status)) {
    throw createHttpError('لا يمكن تسجيل إنجاز لمهمة مكتملة أو ملغاة', 409, 'task_not_changeable');
  }
  const targetQuantity = Number(current.targetQuantity || 0);
  const completedQuantity = Number(current.completedQuantity || 0) + payload.quantity;
  if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 1 || completedQuantity > targetQuantity) {
    throw createHttpError('الكمية المنجزة تتجاوز الكمية المطلوبة أو أن بيانات المهمة غير صالحة', 409, 'quantity_exceeds_target');
  }

  const now = new Date().toISOString();
  const record = {
    ...current,
    completedQuantity,
    status: completedQuantity === targetQuantity ? 'completed' : 'in_progress',
    ...(payload.note ? { lastProgressNote: payload.note } : {}),
    updatedBy: callerUid,
    updatedAt: now
  };
  const taskName = `projects/${projectId}/databases/(default)/documents/tasks/${taskId}`;
  const mutationName = `projects/${projectId}/databases/(default)/documents/${mutationPath}`;
  const mutationRecord = {
    id: payload.clientMutationId,
    taskId,
    quantity: payload.quantity,
    createdBy: callerUid,
    createdAt: now
  };
  try {
    await commitFirestoreTransaction(projectId, accessToken, null, [
      { update: { name: taskName, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: currentDoc.updateTime } },
      { update: { name: mutationName, fields: convertToFirestoreFields(mutationRecord) }, currentDocument: { exists: false } }
    ]);
  } catch (err) {
    // If a retry raced with the first request, the mutation record makes it safe to return success.
    const racedMutation = await getFirestoreDoc(projectId, accessToken, mutationPath);
    if (!racedMutation) throw err;
    const raced = convertFromFirestoreFields(racedMutation.fields || {});
    if (raced.taskId !== taskId || raced.quantity !== payload.quantity) throw createHttpError('معرّف العملية مستخدم لعملية إنجاز مختلفة', 409, 'mutation_id_conflict');
    if (raced.createdBy !== callerUid) throw createHttpError('لا يمكنك إعادة استخدام معرّف إنجاز تابع لمستخدم آخر', 403, 'mutation_owner_mismatch');
    const latestDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
    if (!latestDoc) throw createHttpError('المهمة المطلوبة غير موجودة', 404, 'task_not_found');
    const latestRecord = convertFromFirestoreFields(latestDoc.fields || {});
    if (expectedWorkerId && latestRecord.assignedWorkerId !== expectedWorkerId) throw createHttpError('لا يمكنك الاطلاع على مهمة غير مسندة إليك', 403, 'task_not_assigned');
    return jsonResponse({ success: true, task: sanitizeResourceOutput(latestRecord, 'tasks'), duplicate: true }, 200, corsHeaders);
  }
  return jsonResponse({ success: true, task: sanitizeResourceOutput(record, 'tasks'), duplicate: false }, 200, corsHeaders);
}

function sanitizeResourceOutput(record, resource) {
  const clean = { ...record };
  delete clean.pin;
  delete clean.pin_hash;
  delete clean.pin_salt;
  if (resource === 'workers') delete clean.password;
  return clean;
}

async function handleListModels(request, projectId, accessToken, corsHeaders) {
  const url = new URL(request.url);
  const requestedPageSize = Number(url.searchParams.get('pageSize') || '50');
  const pageSize = Number.isInteger(requestedPageSize)
    ? Math.min(Math.max(requestedPageSize, 1), 100)
    : 50;
  const search = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  const category = url.searchParams.get('category') || '';
  const pageToken = url.searchParams.get('pageToken') || null;
  const result = await listFirestoreDocs(projectId, accessToken, 'models', pageSize, pageToken, '__name__');
  const models = result.documents
    .map((document) => convertFromFirestoreFields(document.fields || {}))
    .filter((model) => !category || model.category === category)
    .filter((model) => !search || String(model.name || '').toLocaleLowerCase().includes(search));

  return jsonResponse(
    {
      success: true,
      models,
      nextPageToken: result.nextPageToken || null,
    },
    200,
    corsHeaders
  );
}

async function handleCreateModel(request, callerUid, projectId, accessToken, corsHeaders) {
  const bodyText = await readStreamWithLimit(request.body, MAX_REQUEST_BODY_BYTES);
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw createHttpError('محتوى الطلب ليس بتنسيق JSON صالح', 400, 'invalid_json');
  }

  // Validate fields strictly (category, image1, image2 are mandatory)
  validateModelPayload(payload, true);

  const { original, normalized, hash: nameHash } = await normalizeModelName(payload.name);
  const modelId = `mod_${crypto.randomUUID().replace(/-/g, '')}`;

  // Image validation (mandatory images)
  validateImageDataUrl(payload.image1, 'image1');
  validateImageDataUrl(payload.image2, 'image2');
  if (payload.image1.length + payload.image2.length > MAX_COMBINED_CHARS) {
    throw createHttpError(
      `مجموع طولي الصورتين (${payload.image1.length + payload.image2.length}) يتجاوز الحد الأقصى المعتمد (${MAX_COMBINED_CHARS})`,
      400,
      'combined_images_oversize'
    );
  }

  const nowIso = new Date().toISOString();

  // Original Data Schema
  const modelDoc = {
    id: modelId,
    name: original,
    name_hash: nameHash,
    category: payload.category, // Mandatory: 'سومال' | 'صيافي' | 'شتاوي'
    image1: payload.image1, // Mandatory
    image2: payload.image2, // Mandatory
    weightMg: payload.weightMg !== undefined ? Number(payload.weightMg) : undefined,
    firstPositionMm: payload.firstPositionMm !== undefined ? Number(payload.firstPositionMm) : undefined,
    lastPositionMm: payload.lastPositionMm !== undefined ? Number(payload.lastPositionMm) : undefined,
    createdBy: callerUid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // Firestore Atomic Transaction
  const tx = await beginFirestoreTransaction(projectId, accessToken);
  let committed = false;

  try {
    // 1. Check if name is already reserved in model_names/{nameHash}
    const existingNameLock = await getFirestoreDoc(projectId, accessToken, `model_names/${nameHash}`, tx.transaction);
    if (existingNameLock) {
      throw createHttpError('اسم الموديل محجوز مسبقاً لموديل آخر. يرجى اختيار اسم فريد.', 409, 'name_already_exists');
    }

    // 2. Commit model and name lock writes atomically
    const writes = [
      {
        update: {
          name: `projects/${projectId}/databases/(default)/documents/model_names/${nameHash}`,
          fields: {
            modelId: { stringValue: modelId },
            normalized_name: { stringValue: normalized },
            createdAt: { stringValue: nowIso },
          },
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `projects/${projectId}/databases/(default)/documents/models/${modelId}`,
          fields: convertToFirestoreFields(modelDoc),
        },
        currentDocument: { exists: false },
      },
    ];

    await commitFirestoreTransaction(projectId, accessToken, tx.transaction, writes);
    committed = true;

    return jsonResponse(
      {
        success: true,
        id: modelId,
        model: modelDoc,
        message: 'تم إضافة الموديل وحجز الاسم بنجاح.',
      },
      201,
      corsHeaders
    );
  } finally {
    if (!committed && tx?.transaction) {
      await rollbackFirestoreTransaction(projectId, accessToken, tx.transaction).catch(() => {});
    }
  }
}

async function handleUpdateModel(request, modelId, callerUid, projectId, accessToken, corsHeaders) {
  const bodyText = await readStreamWithLimit(request.body, MAX_REQUEST_BODY_BYTES);
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw createHttpError('محتوى الطلب ليس بتنسيق JSON صالح', 400, 'invalid_json');
  }

  validateModelPayload(payload, false);

  const tx = await beginFirestoreTransaction(projectId, accessToken);
  let committed = false;

  try {
    const currentModelDoc = await getFirestoreDoc(projectId, accessToken, `models/${modelId}`, tx.transaction);
    if (!currentModelDoc) {
      throw createHttpError('الموديل المطلوب غير موجود أو تم حذفه مسبقاً.', 404, 'model_not_found');
    }

    const currentData = convertFromFirestoreFields(currentModelDoc.fields);
    const oldNameHash = currentData.name_hash;

    let newOriginal = currentData.name;
    let newNameHash = oldNameHash;
    let newNormalized = currentData.name;
    let nameChanged = false;

    if (payload.name && payload.name.trim() !== currentData.name) {
      const normRes = await normalizeModelName(payload.name);
      newOriginal = normRes.original;
      newNameHash = normRes.hash;
      newNormalized = normRes.normalized;
      if (newNameHash !== oldNameHash) {
        nameChanged = true;
      }
    }

    const nowIso = new Date().toISOString();

    const updatedModelDoc = {
      ...currentData,
      name: newOriginal,
      name_hash: newNameHash,
      category: payload.category ?? currentData.category,
      image1: payload.image1 ?? currentData.image1,
      image2: payload.image2 ?? currentData.image2,
      weightMg: payload.weightMg !== undefined ? Number(payload.weightMg) : currentData.weightMg,
      firstPositionMm: payload.firstPositionMm !== undefined ? Number(payload.firstPositionMm) : currentData.firstPositionMm,
      lastPositionMm: payload.lastPositionMm !== undefined ? Number(payload.lastPositionMm) : currentData.lastPositionMm,
      updatedAt: nowIso,
    };

    // Validate images if updated
    validateImageDataUrl(updatedModelDoc.image1, 'image1');
    validateImageDataUrl(updatedModelDoc.image2, 'image2');
    if (updatedModelDoc.image1.length + updatedModelDoc.image2.length > MAX_COMBINED_CHARS) {
      throw createHttpError('مجموع حجم الصورتين يتجاوز الحد الأقصى المعتمد', 400, 'combined_images_oversize');
    }

    const writes = [];

    // If name changed, verify new lock is free and atomically release old lock
    if (nameChanged) {
      const existingNewLock = await getFirestoreDoc(projectId, accessToken, `model_names/${newNameHash}`, tx.transaction);
      if (existingNewLock) {
        throw createHttpError('الاسم الجديد محجوز مسبقاً لموديل آخر.', 409, 'name_already_exists');
      }

      writes.push({
        update: {
          name: `projects/${projectId}/databases/(default)/documents/model_names/${newNameHash}`,
          fields: {
            modelId: { stringValue: modelId },
            normalized_name: { stringValue: newNormalized },
            createdAt: { stringValue: nowIso },
          },
        },
        currentDocument: { exists: false },
      });

      if (oldNameHash) {
        writes.push({
          delete: `projects/${projectId}/databases/(default)/documents/model_names/${oldNameHash}`,
          currentDocument: { exists: true },
        });
      }
    }

    // Update model document with strict precondition
    writes.push({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/models/${modelId}`,
        fields: convertToFirestoreFields(updatedModelDoc),
      },
      currentDocument: { exists: true },
    });

    await commitFirestoreTransaction(projectId, accessToken, tx.transaction, writes);
    committed = true;

    return jsonResponse(
      {
        success: true,
        id: modelId,
        model: updatedModelDoc,
        message: 'تم تحديث الموديل بنجاح.',
      },
      200,
      corsHeaders
    );
  } finally {
    if (!committed && tx?.transaction) {
      await rollbackFirestoreTransaction(projectId, accessToken, tx.transaction).catch(() => {});
    }
  }
}

async function handleDeleteModel(modelId, callerUid, projectId, accessToken, corsHeaders) {
  const tx = await beginFirestoreTransaction(projectId, accessToken);
  let committed = false;

  try {
    const currentModelDoc = await getFirestoreDoc(projectId, accessToken, `models/${modelId}`, tx.transaction);
    if (!currentModelDoc) {
      throw createHttpError('الموديل المطلوب حذفه غير موجود.', 404, 'model_not_found');
    }

    const currentData = convertFromFirestoreFields(currentModelDoc.fields);
    let nameHash = currentData.name_hash;

    // Fallback if name_hash was somehow omitted in document
    if (!nameHash && currentData.name) {
      const norm = await normalizeModelName(currentData.name);
      nameHash = norm.hash;
    }

    const writes = [
      {
        delete: `projects/${projectId}/databases/(default)/documents/models/${modelId}`,
        currentDocument: { exists: true },
      },
    ];

    // Atomically release name reservation with strict existence check
    if (nameHash) {
      writes.push({
        delete: `projects/${projectId}/databases/(default)/documents/model_names/${nameHash}`,
        currentDocument: { exists: true },
      });
    }

    await commitFirestoreTransaction(projectId, accessToken, tx.transaction, writes);
    committed = true;

    return jsonResponse(
      {
        success: true,
        id: modelId,
        message: 'تم حذف الموديل وتحرير حجز الاسم بنجاح.',
      },
      200,
      corsHeaders
    );
  } finally {
    if (!committed && tx?.transaction) {
      await rollbackFirestoreTransaction(projectId, accessToken, tx.transaction).catch(() => {});
    }
  }
}

// ==========================================
// VALIDATION & NORMALIZATION HELPERS
// ==========================================

export function safeDecodeUriSegment(encodedStr) {
  try {
    return decodeURIComponent(encodedStr);
  } catch {
    throw createHttpError('معرّف الموديل مشوّه وغير صالح في مسار URI', 400, 'malformed_uri');
  }
}

export function validateModelPayload(payload, isCreate = true) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError('بيانات الطلب غير صالحة', 400, 'invalid_payload');
  }

  if (isCreate || payload.name !== undefined) {
    if (!payload.name || typeof payload.name !== 'string' || payload.name.trim().length < 2) {
      throw createHttpError('اسم الموديل إلزامي ويجب ألا يقل عن حرفين.', 400, 'invalid_name');
    }
    if (payload.name.trim().length > 60) {
      throw createHttpError('اسم الموديل يجب ألا يتجاوز 60 حرفاً.', 400, 'name_too_long');
    }
  }

  if (isCreate || payload.category !== undefined) {
    const validCategories = ['سومال', 'صيافي', 'شتاوي'];
    if (!validCategories.includes(payload.category)) {
      throw createHttpError('الصنف يجب أن يكون حصراً من: سومال، صيافي، شتاوي.', 400, 'invalid_category');
    }
  }

  if (isCreate) {
    if (!payload.image1 || typeof payload.image1 !== 'string') {
      throw createHttpError('الصورة الأولى (image1) إلزامية.', 400, 'missing_image1');
    }
    if (!payload.image2 || typeof payload.image2 !== 'string') {
      throw createHttpError('الصورة الثانية (image2) إلزامية.', 400, 'missing_image2');
    }
  }

  // Validate optional numeric measurements (original schema: weightMg, firstPositionMm, lastPositionMm)
  if (payload.weightMg !== undefined) {
    const val = Number(payload.weightMg);
    if (!Number.isFinite(val) || val <= 0) {
      throw createHttpError('الوزن weightMg يجب أن يكون رقماً موجباً.', 400, 'invalid_weight');
    }
  }
  if (payload.firstPositionMm !== undefined) {
    const val = Number(payload.firstPositionMm);
    if (!Number.isFinite(val) || val <= 0) {
      throw createHttpError('القياس firstPositionMm يجب أن يكون رقماً موجباً.', 400, 'invalid_first_position');
    }
  }
  if (payload.lastPositionMm !== undefined) {
    const val = Number(payload.lastPositionMm);
    if (!Number.isFinite(val) || val <= 0) {
      throw createHttpError('القياس lastPositionMm يجب أن يكون رقماً موجباً.', 400, 'invalid_last_position');
    }
  }
}

/**
 * Normalizes model name:
 * - Trims leading & trailing whitespace
 * - Collapses repeated whitespace sequences to a single space
 * - Lowercases (casing only)
 * - NO Unicode NFKC (preserves glyph shapes and Arabic Tashkeel & Tatweel)
 */
export async function normalizeModelName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    throw createHttpError('اسم الموديل غير صالح.', 400, 'invalid_name');
  }

  const original = rawName.trim();
  if (original.length < 2 || original.length > 60) {
    throw createHttpError('طول اسم الموديل يجب أن يكون بين 2 و 60 حرفاً.', 400, 'invalid_name_length');
  }

  // 1. Whitespace collapsing and trimming
  let canonical = original.replace(/\s+/g, ' ').trim();

  // 2. Casing normalization only (strictly without NFKC)
  canonical = canonical.toLowerCase();

  if (canonical.length < 2) {
    throw createHttpError('اسم الموديل قصير جداً بعد التنظيف المعياري.', 400, 'invalid_name');
  }

  const hash = await computeWebCryptoSha256(canonical);
  return { original, normalized: canonical, hash };
}

async function computePinPbkdf2(salt, pin) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' },
    material,
    256
  );
  return Array.from(new Uint8Array(bits)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function computeWebCryptoSha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateImageDataUrl(dataUrl, fieldName) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw createHttpError(`الحقل ${fieldName} يجب أن يكون سلسلة Data URL صالحة تبدأ بـ data:image/`, 400, 'invalid_image_format');
  }

  // Length check on FULL dataUrl including MIME prefix
  if (dataUrl.length > MAX_IMAGE_CHARS) {
    throw createHttpError(
      `حجم الصورة ${fieldName} (${dataUrl.length} محرف) يتجاوز الحد الأقصى المسموح (${MAX_IMAGE_CHARS} محرف شاملاً ترويسة الترميز).`,
      400,
      'image_oversize'
    );
  }

  const match = dataUrl.match(/^data:(image\/(webp|jpeg));base64,(.+)$/);
  if (!match) {
    throw createHttpError(`تنسيق الصورة ${fieldName} غير مدعوم، يجب أن يكون WebP أو JPEG مرمّزاً بـ Base64.`, 400, 'unsupported_image_type');
  }

  const mimeType = match[1];
  const b64Data = match[3];

  // Strict Base64 validation
  const rawBytes = decodeStrictBase64(b64Data);

  // Structural inspection
  if (mimeType === 'image/webp') {
    verifyWebPStructure(rawBytes);
  } else if (mimeType === 'image/jpeg') {
    verifyJpegStructure(rawBytes);
  }
}

export function decodeStrictBase64(b64) {
  if (b64.length % 4 !== 0) {
    throw createHttpError('سلسلة Base64 غير صالحة: الطول ليس مضاعفاً لـ 4', 400, 'invalid_base64_length');
  }
  const b64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!b64Regex.test(b64)) {
    throw createHttpError('أحرف غير صالحة في Base64', 400, 'invalid_base64_chars');
  }

  let padCount = 0;
  if (b64.endsWith('==')) padCount = 2;
  else if (b64.endsWith('=')) padCount = 1;

  if (b64.slice(0, b64.length - padCount).includes('=')) {
    throw createHttpError('حشو Base64 غير صالح في منتصف السلسلة', 400, 'invalid_base64_padding');
  }

  // Check RFC 4648 unused bits
  const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lastQuartet = b64.slice(-4);
  if (padCount === 2) {
    const val1 = B64_CHARS.indexOf(lastQuartet[1]);
    if (val1 < 0 || (val1 & 0x0f) !== 0) {
      throw createHttpError('البتات غير المستخدمة في حشو Base64 ليست أصفاراً', 400, 'invalid_base64_unused_bits');
    }
  } else if (padCount === 1) {
    const val2 = B64_CHARS.indexOf(lastQuartet[2]);
    if (val2 < 0 || (val2 & 0x03) !== 0) {
      throw createHttpError('البتات غير المستخدمة في حشو Base64 ليست أصفاراً', 400, 'invalid_base64_unused_bits');
    }
  }

  const binaryStr = atob(b64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

export function verifyWebPStructure(buffer) {
  if (buffer.length < 12) {
    throw createHttpError('الملف أصغر من ترويسة WebP RIFF', 400, 'corrupt_webp');
  }

  const readAscii = (buf, start, end) => {
    let str = '';
    for (let i = start; i < end; i++) str += String.fromCharCode(buf[i]);
    return str;
  };
  const readUInt32LE = (buf, offset) => {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | ((buf[offset + 3] << 24) >>> 0));
  };

  if (readAscii(buffer, 0, 4) !== 'RIFF' || readAscii(buffer, 8, 12) !== 'WEBP') {
    throw createHttpError('توقيع WebP غير صالح', 400, 'invalid_webp_signature');
  }

  const riffPayloadSize = readUInt32LE(buffer, 4);
  const expectedTotalSize = riffPayloadSize + 8;
  if (buffer.length !== expectedTotalSize) {
    throw createHttpError('عدم تطابق حجم RIFF المعلن مع الحجم الفعلي للملف', 400, 'mismatched_riff_size');
  }

  let offset = 12;
  let primaryFormat = null;
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw createHttpError('ترويسة مقطع WebP مبتورة', 400, 'truncated_webp_chunk');
    }

    const chunkFourCC = readAscii(buffer, offset, offset + 4);
    const chunkSize = readUInt32LE(buffer, offset + 4);
    const chunkDataOffset = offset + 8;
    const paddedChunkSize = chunkSize + (chunkSize % 2);

    if (chunkDataOffset + chunkSize > buffer.length) {
      throw createHttpError(`مقطع ${chunkFourCC} يتجاوز نهاية الملف`, 400, 'chunk_overflow_webp');
    }

    if (chunkFourCC === 'VP8 ' && !primaryFormat) {
      primaryFormat = 'VP8';
      if (chunkSize >= 10 && buffer[chunkDataOffset + 3] === 0x9d && buffer[chunkDataOffset + 4] === 0x01 && buffer[chunkDataOffset + 5] === 0x2a) {
        width = (buffer[chunkDataOffset + 6] | (buffer[chunkDataOffset + 7] << 8)) & 0x3fff;
        height = (buffer[chunkDataOffset + 8] | (buffer[chunkDataOffset + 9] << 8)) & 0x3fff;
      }
    } else if (chunkFourCC === 'VP8L' && !primaryFormat) {
      primaryFormat = 'VP8L';
      if (chunkSize >= 5 && buffer[chunkDataOffset] === 0x2f) {
        const b1 = buffer[chunkDataOffset + 1], b2 = buffer[chunkDataOffset + 2];
        const b3 = buffer[chunkDataOffset + 3], b4 = buffer[chunkDataOffset + 4];
        width = 1 + (((b2 & 0x3f) << 8) | b1);
        height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      }
    } else if (chunkFourCC === 'VP8X' && !primaryFormat) {
      primaryFormat = 'VP8X';
      if (chunkSize >= 10) {
        width = 1 + (buffer[chunkDataOffset + 4] | (buffer[chunkDataOffset + 5] << 8) | (buffer[chunkDataOffset + 6] << 16));
        height = 1 + (buffer[chunkDataOffset + 7] | (buffer[chunkDataOffset + 8] << 8) | (buffer[chunkDataOffset + 9] << 16));
      }
    }

    offset = chunkDataOffset + paddedChunkSize;
  }

  if (offset !== buffer.length) {
    throw createHttpError('المقاطع لا تنتهي بالضبط عند نهاية الملف المعلنة', 400, 'webp_chunks_misaligned');
  }

  if (!primaryFormat || width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw createHttpError(`فشل استخراج أبعاد صالحة من صورة WebP (${width}x${height})`, 400, 'invalid_webp_dimensions');
  }
}

export function verifyJpegStructure(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw createHttpError('توقيع بداية JPEG (SOI) غير صحيح', 400, 'invalid_jpeg_soi');
  }

  const readUInt16BE = (buf, offset) => (buf[offset] << 8) | buf[offset + 1];

  let offset = 2;
  let width = 0;
  let height = 0;
  let foundSof = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      throw createHttpError(`علامة JPEG غير صالحة عند ${offset}`, 400, 'invalid_jpeg_marker');
    }

    const marker = buffer[offset + 1];

    if (marker === 0xd9) {
      if (offset + 2 !== buffer.length) {
        throw createHttpError('بيانات زائدة بعد نهاية ملف JPEG (EOI)', 400, 'trailing_jpeg_data');
      }
      break;
    }

    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    if (offset + 4 > buffer.length) {
      throw createHttpError('ترويسة مقطع JPEG مبتورة', 400, 'truncated_jpeg_header');
    }

    const segmentLength = readUInt16BE(buffer, offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      throw createHttpError('طول مقطع JPEG يتجاوز نهاية الملف', 400, 'jpeg_segment_overflow');
    }

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
      foundSof = true;
      if (segmentLength >= 7) {
        height = readUInt16BE(buffer, offset + 5);
        width = readUInt16BE(buffer, offset + 7);
      }
    }

    if (marker === 0xda) {
      offset = offset + 2 + segmentLength;
      let eoiIndex = -1;
      for (let i = offset; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xff) {
          if (buffer[i + 1] === 0x00 || (buffer[i + 1] >= 0xd0 && buffer[i + 1] <= 0xd7)) continue;
          if (buffer[i + 1] === 0xd9) {
            eoiIndex = i;
            break;
          }
        }
      }
      if (eoiIndex === -1) {
        throw createHttpError('علامة نهاية JPEG (EOI) مفقودة', 400, 'missing_jpeg_eoi');
      }
      if (eoiIndex + 2 !== buffer.length) {
        throw createHttpError('بيانات زائدة بعد علامة نهاية JPEG', 400, 'trailing_jpeg_data');
      }
      offset = buffer.length;
      break;
    }

    offset = offset + 2 + segmentLength;
  }

  if (!foundSof || width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw createHttpError(`أبعاد JPEG غير صالحة (${width}x${height})`, 400, 'invalid_jpeg_dimensions');
  }
}

// ==========================================
// STREAMING WITH SIZE ABORT
// ==========================================
async function readStreamWithLimit(readableStream, maxBytes) {
  if (!readableStream) throw createHttpError('محتوى الطلب فارغ', 400, 'empty_body');

  const reader = readableStream.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.length;
    if (totalBytes > maxBytes) {
      reader.cancel();
      throw createHttpError(`حجم الطلب يتجاوز الحد الأقصى المسموح (${Math.round(maxBytes / 1024)} KB)`, 413, 'payload_too_large');
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    merged.set(chunk, pos);
    pos += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

// ==========================================
// FIREBASE AUTH & TOKEN VERIFICATION
// ==========================================

export function verifyTokenHeader(header) {
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw createHttpError('بنية ترويسة رمز المصادقة غير صالحة', 401, 'corrupt_jwt');
  }

  // 1. Mandatory check that header.typ strictly equals 'JWT'
  if (header.typ !== 'JWT') {
    throw createHttpError('نوع الترويسة typ غير صالح، يشترط أن يكون JWT حصراً', 401, 'invalid_jwt_type');
  }

  // 2. Mandatory alg=RS256 and non-empty kid string
  if (header.alg !== 'RS256') {
    throw createHttpError('خوارزمية التوقيع alg غير مدعومة، يشترط RS256', 401, 'invalid_jwt_alg');
  }

  if (typeof header.kid !== 'string' || !header.kid.trim()) {
    throw createHttpError('معرّف المفتاح kid مفقود في ترويسة JWT', 401, 'missing_jwt_kid');
  }

  return true;
}

export function verifyTokenClaims(payload, projectId, nowSec = Math.floor(Date.now() / 1000)) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError('بنية حمولة رمز المصادقة غير صالحة', 401, 'corrupt_jwt');
  }

  // 1. exp must be strictly greater than current time
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    throw createHttpError('انتهت صلاحية جلسة المصادقة (exp يجب أن يكون أكبر من الوقت الحالي)', 401, 'token_expired');
  }

  // 2. iat must be a valid positive integer and not in future beyond skew margin
  if (
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat) ||
    payload.iat <= 0 ||
    payload.iat > nowSec + CLOCK_SKEW_SEC
  ) {
    throw createHttpError('تاريخ إصدار الرمز (iat) غير صالح أو يقع في المستقبل خارج الهامش المعتمد', 401, 'invalid_iat');
  }

  // 3. auth_time must be a valid positive integer
  if (
    typeof payload.auth_time !== 'number' ||
    !Number.isFinite(payload.auth_time) ||
    payload.auth_time <= 0
  ) {
    throw createHttpError('مطالبة auth_time مفقودة أو غير صالحة في رمز المصادقة', 401, 'invalid_auth_time');
  }

  // 4. auth_time must not exceed iat (user authenticates before or at token issue time)
  if (payload.auth_time > payload.iat) {
    throw createHttpError('وقت المصادقة auth_time لا يمكن أن يتجاوز تاريخ إصدار الرمز iat', 401, 'invalid_auth_time');
  }

  // 5. auth_time must not be in future beyond clock skew tolerance
  if (payload.auth_time > nowSec + CLOCK_SKEW_SEC) {
    throw createHttpError('وقت المصادقة auth_time يقع في المستقبل خارج هامش التوقيت المعتمد', 401, 'invalid_auth_time');
  }

  // 6. auth_time must not exceed exp
  if (payload.auth_time > payload.exp) {
    throw createHttpError('توقيت auth_time يتجاوز تاريخ انتهاء صلاحية الرمز exp', 401, 'invalid_auth_time');
  }

  // 7. Issuer & Audience checks
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw createHttpError('مُصدر الرمز (iss) غير مطابق للمشروع', 401, 'invalid_issuer');
  }
  if (payload.aud !== projectId) {
    throw createHttpError('وجهة الرمز (aud) غير مطابقة للمشروع', 401, 'invalid_audience');
  }

  // 8. Subject (user ID) check
  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0 || payload.sub.length > 128) {
    throw createHttpError('معرّف المستخدم (sub) مفقود أو غير صالح في الرمز', 401, 'missing_sub');
  }

  return true;
}

export function validateGoogleJwk(key, expectedKid) {
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    throw createHttpError('مفتاح JWK غير صالح أو فارغ', 500, 'invalid_jwk');
  }

  // Mandatory fields matching
  if (key.kty !== 'RSA') {
    throw createHttpError(`نوع المفتاح kty (${key.kty}) غير مطابق، يشترط kty=RSA`, 500, 'invalid_jwk_kty');
  }
  if (key.use !== 'sig') {
    throw createHttpError(`استخدام المفتاح use (${key.use}) غير مطابق، يشترط use=sig`, 500, 'invalid_jwk_use');
  }
  if (key.alg !== 'RS256') {
    throw createHttpError(`خوارزمية المفتاح alg (${key.alg}) غير مطابقة، يشترط alg=RS256`, 500, 'invalid_jwk_alg');
  }
  if (key.kid !== expectedKid) {
    throw createHttpError('معرّف المفتاح kid لا يتطابق مع ترويسة JWT', 500, 'mismatched_jwk_kid');
  }

  // Strict verification of modulus (n) and exponent (e) Base64URL encoding
  if (typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{20,}$/.test(key.n)) {
    throw createHttpError('معامل n لمفتاح RSA العام مفقود أو غير صالح بصيغة Base64URL', 500, 'invalid_jwk_modulus');
  }
  if (typeof key.e !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(key.e)) {
    throw createHttpError('معامل e لمفتاح RSA العام مفقود أو غير صالح بصيغة Base64URL', 500, 'invalid_jwk_exponent');
  }

  return true;
}

async function verifyFirebaseIdToken(token, projectId) {
  if (typeof token !== 'string' || token.length < 20 || token.length > MAX_JWT_CHARS) {
    throw createHttpError('طول رمز المصادقة غير صالح أو مريب', 401, 'invalid_jwt_length');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw createHttpError('صيغة رمز المصادقة غير صالحة', 401, 'invalid_jwt_format');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw createHttpError('فشل فك محتوى رمز المصادقة', 401, 'corrupt_jwt');
  }

  // 1. Strict header checks (typ === 'JWT', alg === 'RS256', non-empty kid)
  verifyTokenHeader(header);

  // 2. Strict claims checks (exp > now, valid iat, auth_time <= iat & <= exp, aud, iss, sub)
  verifyTokenClaims(payload, projectId);

  // 3. Fetch and validate Google Public JWK structure (kty, use, alg, kid, n, e)
  const jwk = await getGoogleJwk(header.kid);

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToBytes(sigB64);

  const isValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, signedData);
  if (!isValid) {
    throw createHttpError('توقيع رمز المصادقة غير صحيح', 401, 'invalid_signature');
  }

  return payload;
}

async function getGoogleJwk(kid) {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expiresAt > now) {
    const key = jwksCache.keys.find((k) => k.kid === kid);
    if (key) {
      validateGoogleJwk(key, kid);
      return key;
    }
  }

  const resp = await fetch(GOOGLE_JWKS_URL);
  if (!resp.ok) {
    throw createHttpError('تعذر جلب مفاتيح Google العامة للتحقق من التوقيع', 500, 'jwks_fetch_failed');
  }

  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  const data = await resp.json();
  if (!data || !Array.isArray(data.keys)) {
    throw createHttpError('استجابة JWKS من Google غير صالحة', 500, 'invalid_jwks_response');
  }

  jwksCache = { keys: data.keys, expiresAt: now + maxAgeSec * 1000 };

  const foundKey = data.keys.find((k) => k.kid === kid);
  if (!foundKey) {
    throw createHttpError(`مفتاح التوقيع (${kid}) غير معروف في قائمة JWKS الرسمية`, 401, 'unknown_kid');
  }

  validateGoogleJwk(foundKey, kid);
  return foundKey;
}

function parseServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw createHttpError('متغير البيئة FIREBASE_SERVICE_ACCOUNT مفقود في الخادم', 500, 'missing_sa_secret');
  }
  try {
    return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw createHttpError('تنسيق FIREBASE_SERVICE_ACCOUNT غير صالح (ليس JSON)', 500, 'invalid_sa_format');
  }
}

async function getServiceAccountAccessToken(sa) {
  const now = Date.now();
  if (serviceAccountTokenCache.token && serviceAccountTokenCache.expiresAt > now + 60000) {
    return serviceAccountTokenCache.token;
  }

  const nowSec = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: GOOGLE_TOKEN_URL,
    exp: nowSec + 3600,
    iat: nowSec,
  };

  const encHeader = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const toSign = `${encHeader}.${encPayload}`;

  const privateKey = await importPkcs8PrivateKey(sa.private_key);
  const sigBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(toSign));
  const assertion = `${toSign}.${bytesToBase64Url(new Uint8Array(sigBuffer))}`;

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
  });

  const resJson = await resp.json();
  if (!resp.ok || !resJson.access_token) {
    throw createHttpError('فشل الحصول على Access Token لحساب الخدمة من Google', 500, 'sa_token_grant_failed');
  }

  serviceAccountTokenCache = {
    token: resJson.access_token,
    expiresAt: now + (resJson.expires_in || 3600) * 1000,
  };

  return resJson.access_token;
}

async function importPkcs8PrivateKey(pem) {
  const cleanPem = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\r|\n|\s/g, '');
  const binary = atob(cleanPem);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return await crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// ==========================================
// RBAC & FIRESTORE TRANSACTIONS
// ==========================================
async function verifyManagementRole(uid, projectId, accessToken) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents/users/${uid}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (resp.status === 404) {
    throw createHttpError('ملف المستخدم غير موجود في النظام', 403, 'user_record_not_found');
  }
  if (!resp.ok) {
    throw createHttpError('تعذر التحقق من صلاحيات المستخدم في قاعدة البيانات', 500, 'rbac_check_failed');
  }

  const doc = await resp.json();
  const fields = convertFromFirestoreFields(doc.fields || {});
  if (!['admin', 'super_admin', 'responsible'].includes(fields.role) || fields.status !== 'active') {
    throw createHttpError('يلزم حساب مسؤول أو مشرف نشط لتنفيذ هذه العملية', 403, 'forbidden');
  }
  return fields.role;
}

async function beginFirestoreTransaction(projectId, accessToken) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents:beginTransaction`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ options: { readWrite: {} } }),
  });

  if (!resp.ok) throw createHttpError('فشل بدء المعاملة الذرية في Firestore', 500, 'tx_begin_failed');
  return await resp.json();
}

async function commitFirestoreTransaction(projectId, accessToken, transactionId, writes) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents:commit`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(transactionId ? { transaction: transactionId, writes } : { writes }),
  });

  const resData = await resp.json();
  if (!resp.ok) {
    const errMsg = resData?.error?.message || 'فشل تثبيت المعاملة الذرية';
    if (errMsg.includes('ALREADY_EXISTS') || errMsg.includes('ABORTED') || errMsg.includes('FAILED_PRECONDITION')) {
      throw createHttpError('تعارضت العملية مع تعديل متزامن؛ حدّث البيانات ثم حاول مجدداً', 409, 'conflict');
    }
    throw createHttpError(`فشل إتمام المعاملة: ${errMsg}`, 500, 'tx_commit_failed');
  }
  return resData;
}

async function rollbackFirestoreTransaction(projectId, accessToken, transactionId) {
  const url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents:rollback`;
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transaction: transactionId }),
  });
}

async function getFirestoreDoc(projectId, accessToken, path, transactionId) {
  let url = `${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents/${path}`;
  if (transactionId) {
    url += `?transaction=${encodeURIComponent(transactionId)}`;
  }

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) throw createHttpError(`فشل قراءة الوثيقة ${path}`, 500, 'doc_read_failed');
  return await resp.json();
}

async function listFirestoreDocs(projectId, accessToken, collection, pageSize, pageToken, orderBy, fieldMask) {
  const url = new URL(`${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents/${collection}`);
  url.searchParams.set('pageSize', String(pageSize));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  if (orderBy) url.searchParams.set('orderBy', orderBy);
  if (Array.isArray(fieldMask)) {
    for (const fieldPath of fieldMask) url.searchParams.append('mask.fieldPaths', fieldPath);
  }
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw createHttpError('فشل قراءة قائمة الموديلات من Firestore', 500, 'collection_read_failed');
  }
  const data = await resp.json();
  return {
    documents: Array.isArray(data.documents) ? data.documents : [],
    nextPageToken: data.nextPageToken || null,
  };
}

async function listAllFirestoreDocs(projectId, accessToken, collection, pageSize = 100, maxDocuments = 500) {
  const documents = [];
  let pageToken = null;
  do {
    const remaining = maxDocuments - documents.length;
    if (remaining <= 0) {
      throw createHttpError('تجاوز عدد السجلات الحد الآمن للقراءة؛ لم تُستخدم قائمة ناقصة لاتخاذ القرار', 503, 'collection_read_limit_exceeded');
    }
    const page = await listFirestoreDocs(projectId, accessToken, collection, Math.min(pageSize, remaining), pageToken);
    documents.push(...page.documents);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { documents, nextPageToken: null };
}

// Convert native JS object to Firestore REST API fields
function convertToFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(convertToFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: convertToFirestoreFields(value) } };
  throw new TypeError('Unsupported Firestore value type');
}

export function convertToFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined) continue;
    fields[key] = convertToFirestoreValue(value);
  }
  return fields;
}

function convertFromFirestoreValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.arrayValue?.values) return value.arrayValue.values.map(convertFromFirestoreValue);
  if (value.mapValue?.fields) return convertFromFirestoreFields(value.mapValue.fields);
  return undefined;
}

export function convertFromFirestoreFields(fields) {
  const obj = {};
  for (const [key, value] of Object.entries(fields || {})) {
    obj[key] = convertFromFirestoreValue(value);
  }
  return obj;
}

// ==========================================
// CORS SECURITY & UTILITIES
// ==========================================
export function getAllowedOrigins(env) {
  const allowed = new Set([
    'https://fc-founoun.web.app',
    'https://fc-founoun.firebaseapp.com',
    'https://deploy-preview-3--fc-founoun.netlify.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ]);

  if (env?.APP_URL) {
    allowed.add(env.APP_URL.trim().replace(/\/+$/, ''));
  }
  if (env?.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(',').forEach((o) => {
      const trimmed = o.trim().replace(/\/+$/, '');
      if (trimmed) allowed.add(trimmed);
    });
  }

  return allowed;
}

export function isOriginAllowed(origin, env) {
  if (!origin) return false;
  const allowed = getAllowedOrigins(env);
  return allowed.has(origin.trim().replace(/\/+$/, ''));
}

export function getCorsHeaders(origin, isAllowed) {
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function handleCorsPreflight(request, env, isAllowed) {
  const origin = request.headers.get('Origin');
  if (origin && !isAllowed) {
    return new Response(JSON.stringify({ success: false, error: 'المصدر غير مسموح به عبر سياسة CORS' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Vary': 'Origin',
      },
    });
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin, isAllowed),
  });
}

function createHttpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

function base64UrlToBytes(str) {
  const bin = base64UrlDecode(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
