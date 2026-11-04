export type WorkerStatus = 'active' | 'inactive';
export interface WorkerRecord { id: string; name: string; phone?: string; status: WorkerStatus; createdAt?: string; updatedAt?: string; }
export interface TaskRecord { id: string; title: string; description?: string; modelId?: string; modelName?: string; assignedWorkerId: string; assignedWorkerName?: string; targetQuantity: number; completedQuantity: number; status: 'open' | 'in_progress' | 'completed' | 'cancelled'; dueDate?: string; createdAt?: string; updatedAt?: string; }
export interface WorkerPayload { name: string; phone?: string; status?: WorkerStatus; }
export interface TaskPayload { title: string; description?: string; modelId?: string; modelName?: string; assignedWorkerId: string; targetQuantity: number; dueDate?: string; }
export interface ChatMessage { id: string; workerId: string; senderUid: string; senderRole: 'admin' | 'super_admin' | 'worker'; senderName: string; text: string; createdAt: string; }
export interface ProgressPayload { quantity: number; note?: string; clientMutationId: string; }
export interface OperationsResponse<T> { success: boolean; data: T; nextPageToken?: string | null; message?: string; }
