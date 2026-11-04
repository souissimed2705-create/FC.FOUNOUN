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
    if (managementRoute?.error) {
      return jsonResponse({ success: false, error: managementRoute.error.message, code: managementRoute.error.code }, 400, corsHeaders);
    }
    if (!managementRoute && !cleanPath.startsWith('/api/models')) {
      return jsonResponse({ success: false, error: 'المسار المطلوب غير موجود', code: 'not_found' }, 404, corsHeaders);
    }

    let modelIdParam = null;
    const modelsPrefix = '/api/models';

    if (managementRoute) {
      // Validated by parseManagementRoute; no nested or ambiguous paths reach handlers.
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
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse(
          { success: false, error: 'رمز المصادقة مفقود أو غير صالح. يرجى تسجيل الدخول كمدير عام.', code: 'unauthorized' },
          401,
          corsHeaders
        );
      }

      const idToken = authHeader.slice(7).trim();
      const serviceAccount = parseServiceAccount(env);
      const projectId = env.PROJECT_ID || serviceAccount.project_id || 'fc-founoun';

      const decodedToken = await verifyFirebaseIdToken(idToken, projectId);
      const callerUid = decodedToken.sub;

      // 4. Verify Super Admin RBAC via Firestore
      const saAccessToken = await getServiceAccountAccessToken(serviceAccount);
      await verifySuperAdminRole(callerUid, projectId, saAccessToken);

      // 5. Dispatch Route Handlers
      if (managementRoute) {
        return await dispatchManagementRoute(request, managementRoute, callerUid, projectId, saAccessToken, corsHeaders);
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

async function dispatchManagementRoute(request, route, callerUid, projectId, accessToken, corsHeaders) {
  if (route.resource === 'workers' && route.action === 'pin') {
    return handleSetWorkerPin(request, route.id, callerUid, projectId, accessToken, corsHeaders);
  }
  if (route.resource === 'workers') {
    if (request.method === 'GET') return handleListResource(request, 'workers', projectId, accessToken, corsHeaders);
    if (request.method === 'POST') return handleCreateResource(request, 'workers', callerUid, projectId, accessToken, corsHeaders);
    if (request.method === 'PUT') return handleUpdateResource(request, 'workers', route.id, callerUid, projectId, accessToken, corsHeaders);
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
  workers: ['name', 'phone', 'email', 'status', 'notes', 'role'],
  tasks: ['title', 'description', 'status', 'priority', 'assignedWorkerId', 'assignedWorkerName', 'modelId', 'modelName', 'targetQuantity', 'completedQuantity', 'dueDate'],
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
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 2000)) {
      throw createHttpError(`قيمة الحقل ${key} غير صالحة`, 400, 'invalid_field');
    }
  }
}

async function parseJsonBody(request) {
  let payload;
  try { payload = JSON.parse(await readStreamWithLimit(request.body, 64 * 1024)); }
  catch (err) {
    if (err?.code === 'payload_too_large') throw err;
    throw createHttpError('محتوى الطلب ليس بتنسيق JSON صالح', 400, 'invalid_json');
  }
  return payload;
}

async function handleListResource(request, resource, projectId, accessToken, corsHeaders) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('pageSize') || '50');
  const pageSize = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
  const result = await listFirestoreDocs(projectId, accessToken, resource, pageSize);
  const records = result.documents.map((doc) => sanitizeResourceOutput(convertFromFirestoreFields(doc.fields || {}), resource));
  return jsonResponse({ success: true, [resource]: records, nextPageToken: result.nextPageToken }, 200, corsHeaders);
}

async function handleCreateResource(request, resource, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  validateResourcePayload(payload, resource, true);
  const id = `${resource === 'workers' ? 'wkr' : 'tsk'}_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const defaults = resource === 'workers' ? { status: 'active' } : { status: 'open', completedQuantity: 0 };
  const record = { id, ...defaults, ...payload, createdBy: callerUid, createdAt: now, updatedAt: now };
  const writes = [{ update: { name: `projects/${projectId}/databases/(default)/documents/${resource}/${id}`, fields: convertToFirestoreFields(record) }, currentDocument: { exists: false } }];
  await commitFirestoreTransaction(projectId, accessToken, null, writes);
  return jsonResponse({ success: true, [resource === 'workers' ? 'worker' : 'task']: record }, 201, corsHeaders);
}

async function handleUpdateResource(request, resource, id, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  validateResourcePayload(payload, resource, false);
  const currentDoc = await getFirestoreDoc(projectId, accessToken, `${resource}/${id}`);
  if (!currentDoc) throw createHttpError('المورد المطلوب غير موجود', 404, 'resource_not_found');
  const current = convertFromFirestoreFields(currentDoc.fields || {});
  const record = { ...current, ...payload, updatedBy: callerUid, updatedAt: new Date().toISOString() };
  const write = { update: { name: `projects/${projectId}/databases/(default)/documents/${resource}/${id}`, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: currentDoc.updateTime } };
  await commitFirestoreTransaction(projectId, accessToken, null, [write]);
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

async function handleDeleteResource(id, resource, projectId, accessToken, corsHeaders) {
  const current = await getFirestoreDoc(projectId, accessToken, `${resource}/${id}`);
  if (!current) throw createHttpError('المورد المطلوب غير موجود', 404, 'resource_not_found');
  await commitFirestoreTransaction(projectId, accessToken, null, [{ delete: `projects/${projectId}/databases/(default)/documents/${resource}/${id}`, currentDocument: { updateTime: current.updateTime } }]);
  return jsonResponse({ success: true, id }, 200, corsHeaders);
}

async function handleSetWorkerPin(request, workerId, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  if (!payload || typeof payload.pin !== 'string' || !/^\d{6}$/.test(payload.pin)) {
    throw createHttpError('PIN يجب أن يتكون من 6 أرقام بالضبط', 400, 'invalid_pin');
  }
  const worker = await getFirestoreDoc(projectId, accessToken, `workers/${workerId}`);
  if (!worker) throw createHttpError('العامل المطلوب غير موجود', 404, 'worker_not_found');
  const salt = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const pinHash = await computeWebCryptoSha256(`${salt}:${payload.pin}`);
  const pinRecord = { workerId, pin_hash: pinHash, pin_salt: salt, updatedBy: callerUid, updatedAt: new Date().toISOString() };
  await commitFirestoreTransaction(projectId, accessToken, null, [{ update: { name: `projects/${projectId}/databases/(default)/documents/worker_pins/${workerId}`, fields: convertToFirestoreFields(pinRecord) } }]);
  return jsonResponse({ success: true, workerId, message: 'تم حفظ PIN بشكل hash فقط' }, 200, corsHeaders);
}

async function handleTaskProgress(request, taskId, callerUid, projectId, accessToken, corsHeaders) {
  const payload = await parseJsonBody(request);
  if (!payload || !Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > 1000000) {
    throw createHttpError('quantity يجب أن يكون عدداً صحيحاً موجباً', 400, 'invalid_quantity');
  }
  if (payload.note !== undefined && (typeof payload.note !== 'string' || payload.note.length > 2000)) {
    throw createHttpError('ملاحظة الإنجاز غير صالحة', 400, 'invalid_note');
  }
  const currentDoc = await getFirestoreDoc(projectId, accessToken, `tasks/${taskId}`);
  if (!currentDoc) throw createHttpError('المهمة المطلوبة غير موجودة', 404, 'task_not_found');
  const current = convertFromFirestoreFields(currentDoc.fields || {});
  const targetQuantity = Number(current.targetQuantity || 0);
  const completedQuantity = Number(current.completedQuantity || 0) + payload.quantity;
  if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 1 || completedQuantity > targetQuantity) {
    throw createHttpError('الكمية المنجزة تتجاوز الكمية المطلوبة أو أن بيانات المهمة غير صالحة', 409, 'quantity_exceeds_target');
  }
  const record = {
    ...current,
    completedQuantity,
    status: completedQuantity === targetQuantity ? 'completed' : 'in_progress',
    ...(payload.note ? { lastProgressNote: payload.note } : {}),
    updatedBy: callerUid,
    updatedAt: new Date().toISOString()
  };
  await commitFirestoreTransaction(projectId, accessToken, null, [{ update: { name: `projects/${projectId}/databases/(default)/documents/tasks/${taskId}`, fields: convertToFirestoreFields(record) }, currentDocument: { updateTime: currentDoc.updateTime } }]);
  return jsonResponse({ success: true, task: sanitizeResourceOutput(record, 'tasks') }, 200, corsHeaders);
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
  const result = await listFirestoreDocs(projectId, accessToken, 'models', pageSize);
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
async function verifySuperAdminRole(uid, projectId, accessToken) {
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

  if (fields.role !== 'super_admin' || fields.status !== 'active') {
    throw createHttpError('ليس لديك صلاحية المدير العام (super_admin) أو الحساب غير نشط', 403, 'forbidden');
  }
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
      throw createHttpError('تعارض في الحجز أو أن اسم الموديل محجوز بالفعل لموديل آخر', 409, 'conflict');
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

async function listFirestoreDocs(projectId, accessToken, collection, pageSize) {
  const url = new URL(`${FIRESTORE_BASE_URL}/${projectId}/databases/(default)/documents/${collection}`);
  url.searchParams.set('pageSize', String(pageSize));
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

// Convert native JS object to Firestore REST API fields
export function convertToFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'number') {
      if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
      else fields[key] = { doubleValue: value };
    } else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (typeof value === 'object' && value !== null) {
      fields[key] = { mapValue: { fields: convertToFirestoreFields(value) } };
    }
  }
  return fields;
}

export function convertFromFirestoreFields(fields) {
  const obj = {};
  for (const [key, valObj] of Object.entries(fields || {})) {
    if (valObj.stringValue !== undefined) obj[key] = valObj.stringValue;
    else if (valObj.integerValue !== undefined) obj[key] = parseInt(valObj.integerValue, 10);
    else if (valObj.doubleValue !== undefined) obj[key] = valObj.doubleValue;
    else if (valObj.booleanValue !== undefined) obj[key] = valObj.booleanValue;
    else if (valObj.mapValue?.fields) {
      obj[key] = convertFromFirestoreFields(valObj.mapValue.fields);
    }
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
