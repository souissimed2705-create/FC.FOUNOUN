import { auth } from './firebase';
import type { OperationsResponse, ProgressPayload, TaskPayload, TaskRecord, WorkerPayload, WorkerRecord, ChatMessage, MachineCycleRecord, ManagementAccountRecord, ContactRecord } from '../types/operations';

const BASE = ((import.meta.env.VITE_WORKER_URL as string | undefined) || 'https://shiny-bird-56fc.souissimed2705.workers.dev').replace(/\/$/, '');
const QUEUE_KEY_PREFIX = 'fc-founoun-offline-operations-v2';
function currentQueueKey() { return `${QUEUE_KEY_PREFIX}:${auth.currentUser?.uid || 'anonymous'}`; }

async function token() { if (!auth.currentUser) throw new Error('يجب تسجيل الدخول أولاً.'); return auth.currentUser.getIdToken(false); }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}`, ...(init.headers || {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error || `فشل الطلب (${response.status})`);
  // Normalize the Worker named-resource responses to the data shape consumed by the UI.
  if (body.data === undefined) {
    const resourceData = body.workers ?? body.tasks ?? body.worker ?? body.task ?? body;
    return { ...body, data: resourceData } as T;
  }
  return body as T;
}
export const listWorkers = () => request<OperationsResponse<WorkerRecord[]>>('/api/workers');
export const createWorker = (payload: WorkerPayload) => request<OperationsResponse<WorkerRecord>>('/api/workers', { method: 'POST', body: JSON.stringify(payload) });
export const updateWorker = (id: string, payload: Partial<WorkerPayload>) => request<OperationsResponse<WorkerRecord>>(`/api/workers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
export const deleteWorker = (id: string) => request<OperationsResponse<{ id: string }>>(`/api/workers/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const setWorkerPin = (id: string, pin: string) => request<OperationsResponse<{ id: string }>>(`/api/workers/${encodeURIComponent(id)}/pin`, { method: 'PUT', body: JSON.stringify({ pin }) });
export const listTasks = () => request<OperationsResponse<TaskRecord[]>>('/api/tasks');
export const createTask = (payload: TaskPayload) => request<OperationsResponse<TaskRecord>>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
export const updateTask = (id: string, payload: Partial<TaskPayload & Pick<TaskRecord, 'status'>>) => request<OperationsResponse<TaskRecord>>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
export const recordProgress = (id: string, payload: ProgressPayload) => request<OperationsResponse<TaskRecord>>(`/api/tasks/${encodeURIComponent(id)}/progress`, { method: 'POST', body: JSON.stringify(payload) });
export const listConversation = (workerId: string) => request<OperationsResponse<ChatMessage[]>>(`/api/messages?workerId=${encodeURIComponent(workerId)}`);
export const sendManagementMessage = (workerId: string, text: string) => request<OperationsResponse<ChatMessage>>('/api/messages', { method: 'POST', body: JSON.stringify({ workerId, text }) });
export const listMachineCycles = (pageToken?: string | null) => {
  const params = new URLSearchParams({ pageSize: '100' });
  if (pageToken) params.set('pageToken', pageToken);
  return request<OperationsResponse<MachineCycleRecord[]> & { nextPageToken?: string | null }>(`/api/cycles?${params.toString()}`);
};
export const getMachineCyclePhoto = (id: string) => request<OperationsResponse<{ id: string; photo: string }>>(`/api/cycles/${encodeURIComponent(id)}/photo`);
export const listManagementAccounts = () => request<OperationsResponse<ManagementAccountRecord[]>>('/api/management-accounts');
export const createManagementAccount = (payload: { name: string; role: 'admin' | 'responsible'; code: string; shift?: 'day' | 'night' }) => request<OperationsResponse<ManagementAccountRecord>>('/api/management-accounts', { method: 'POST', body: JSON.stringify(payload) });
export const updateManagementAccount = (uid: string, payload: { name?: string; status?: 'active' | 'inactive'; shift?: 'day' | 'night' }) => request<OperationsResponse<ManagementAccountRecord>>(`/api/management-accounts/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify(payload) });
export const setManagementCode = (uid: string, code: string) => request<OperationsResponse<{ uid: string }>>(`/api/management-accounts/${encodeURIComponent(uid)}/code`, { method: 'PUT', body: JSON.stringify({ code }) });
export const freezeManagementAccount = (uid: string) => request<OperationsResponse<ManagementAccountRecord>>(`/api/management-accounts/${encodeURIComponent(uid)}`, { method: 'DELETE' });
export const listContacts = () => request<OperationsResponse<ContactRecord[]>>('/api/contacts');
export const listDirectMessages = (otherUid: string) => request<OperationsResponse<ChatMessage[]>>(`/api/direct-messages/${encodeURIComponent(otherUid)}`);
export const sendDirectMessage = (otherUid: string, text: string) => request<OperationsResponse<ChatMessage>>(`/api/direct-messages/${encodeURIComponent(otherUid)}`, { method: 'POST', body: JSON.stringify({ text }) });
export const listMyMachineCycles = (pageToken?: string | null) => {
  const params = new URLSearchParams({ pageSize: '100' });
  if (pageToken) params.set('pageToken', pageToken);
  return request<OperationsResponse<MachineCycleRecord[]> & { nextPageToken?: string | null }>(`/api/worker/cycles?${params.toString()}`);
};
export const submitMachineCycle = (count: number, photo: string, recordedAt: string) => request<OperationsResponse<MachineCycleRecord>>('/api/worker/cycles', { method: 'POST', body: JSON.stringify({ count, photo, recordedAt }) });

type QueuedMutation = { id: string; path: string; init: RequestInit; createdAt: string };
export function queueMutation(path: string, init: RequestInit) { if (!auth.currentUser) throw new Error('لا يمكن حفظ عملية دون اتصال قبل تسجيل الدخول.'); const queue = readQueue(); queue.push({ id: crypto.randomUUID(), path, init, createdAt: new Date().toISOString() }); localStorage.setItem(currentQueueKey(), JSON.stringify(queue)); }
function readQueue(): QueuedMutation[] { try { return JSON.parse(localStorage.getItem(currentQueueKey()) || '[]'); } catch { return []; } }
export function queuedMutationCount() { return readQueue().length; }
export async function flushQueuedMutations() { const queue = readQueue(); if (!queue.length || !navigator.onLine) return 0; let flushed = 0; for (const item of queue) { try { await request(item.path, item.init); flushed++; } catch { break; } } if (flushed) localStorage.setItem(currentQueueKey(), JSON.stringify(queue.slice(flushed))); return flushed; }

export async function managementLogin(name: string, code: string, role: 'admin' | 'responsible'): Promise<{ customToken: string; user: { uid: string; displayName: string; role: string } }> {
  const response = await fetch(`${BASE}/api/management-auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code, role }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.customToken) throw new Error(body?.error || 'تعذر تسجيل الدخول.');
  return { customToken: body.customToken, user: body.user };
}

export async function workerLogin(name: string, pin: string): Promise<{ customToken: string; worker: { id: string; name: string } }> {
  const response = await fetch(`${BASE}/api/worker-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pin }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body?.customToken) throw new Error(body?.error || 'تعذر تسجيل دخول العامل.');
  return { customToken: body.customToken, worker: body.worker };
}
export const listMyTasks = () => request<OperationsResponse<TaskRecord[]>>('/api/worker/tasks');
export const updateMyTaskStatus = (id: string, status: 'pending' | 'in_progress') => request<OperationsResponse<TaskRecord>>(`/api/worker/tasks/${encodeURIComponent(id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const recordMyProgress = (id: string, payload: ProgressPayload) => request<OperationsResponse<TaskRecord>>(`/api/worker/tasks/${encodeURIComponent(id)}/progress`, { method: 'POST', body: JSON.stringify(payload) });
export const listMyConversation = () => request<OperationsResponse<ChatMessage[]>>('/api/worker/messages');
export const sendWorkerMessage = (text: string) => request<OperationsResponse<ChatMessage>>('/api/worker/messages', { method: 'POST', body: JSON.stringify({ text }) });
