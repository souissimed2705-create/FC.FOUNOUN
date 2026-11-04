export type WorkerStatus = 'active' | 'inactive';
export interface WorkerRecord { id: string; name: string; phone?: string; status: WorkerStatus; machineNumber?: 1 | 2 | 3; shift?: 'day' | 'night'; createdAt?: string; updatedAt?: string; }
export interface TaskRecord { id: string; title: string; description?: string; modelId?: string; modelName?: string; modelCategory?: string; assignedWorkerId: string; assignedWorkerName?: string; machineNumber?: 1 | 2 | 3; shift?: 'day' | 'night'; targetQuantity: number; completedQuantity: number; status: 'open' | 'in_progress' | 'pending' | 'completed' | 'cancelled'; dueDate?: string; createdAt?: string; updatedAt?: string; }
export interface WorkerPayload { name: string; phone?: string; status?: WorkerStatus; machineNumber?: 1 | 2 | 3; shift?: 'day' | 'night'; }
export interface MachineCycleRecord { id: string; machineNumber: 1 | 2 | 3; shift: 'day' | 'night'; date: string; count: number; workerId: string; workerName: string; recordedAt: string; updatedAt?: string; hasPhoto?: boolean; photo?: string; }
export interface TaskPayload { title: string; description?: string; modelId?: string; modelName?: string; modelCategory?: string; assignedWorkerId: string; targetQuantity: number; dueDate?: string; }
export interface ChatMessage { id: string; workerId: string; senderUid: string; senderRole: 'admin' | 'super_admin' | 'worker'; senderName: string; text: string; createdAt: string; }
export interface ProgressPayload { quantity: number; note?: string; clientMutationId: string; }
export interface OperationsResponse<T> { success: boolean; data: T; nextPageToken?: string | null; message?: string; }
