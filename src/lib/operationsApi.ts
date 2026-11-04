import { auth } from './firebase';
import type { OperationsResponse, ProgressPayload, TaskPayload, TaskRecord, WorkerPayload, WorkerRecord } from '../types/operations';

const BASE = ((import.meta.env.VITE_WORKER_URL as string | undefined) || 'https://shiny-bird-56fc.souissimed2705.workers.dev').replace(/\/$/, '');
const QUEUE_KEY = 'fc-founoun-offline-operations-v1';

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

type QueuedMutation = { id: string; path: string; init: RequestInit; createdAt: string };
export function queueMutation(path: string, init: RequestInit) { const queue = readQueue(); queue.push({ id: crypto.randomUUID(), path, init, createdAt: new Date().toISOString() }); localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
function readQueue(): QueuedMutation[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
export function queuedMutationCount() { return readQueue().length; }
export async function flushQueuedMutations() { const queue = readQueue(); if (!queue.length || !navigator.onLine) return 0; let flushed = 0; for (const item of queue) { try { await request(item.path, item.init); flushed++; } catch { break; } } if (flushed) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(flushed))); return flushed; }
