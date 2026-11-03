export type ShoeCategory = 'سومال' | 'صيافي' | 'شتاوي';

export interface ShoeModel {
  id: string; // Document ID in Firestore 'models/{id}'
  name: string; // Original brand display name entered by admin (e.g., 'TRENTE')
  name_hash: string; // SHA-256 of normalized canonical name
  category: ShoeCategory; // Mandatory: 'سومال' | 'صيافي' | 'شتاوي'
  image1: string; // Mandatory: Full data URL (data:image/...;base64,...), max 320,000 chars
  image2: string; // Mandatory: Full data URL, max 320,000 chars, combined <= 600,000 chars
  weightMg?: number; // Optional weight in milligrams (positive integer)
  firstPositionMm?: number; // Optional measurement in millimeters
  lastPositionMm?: number; // Optional measurement in millimeters
  createdBy: string; // UID of admin
  createdAt: string; // ISO 8601 string
  updatedAt: string; // ISO 8601 string
}

export interface CreateModelPayload {
  name: string;
  category: ShoeCategory; // Mandatory
  image1: string; // Mandatory: Full data URL
  image2: string; // Mandatory: Full data URL
  weightMg?: number;
  firstPositionMm?: number;
  lastPositionMm?: number;
}

export interface UpdateModelPayload extends Partial<CreateModelPayload> {
  id?: string;
}

// Unified API Response Models matching Cloudflare Worker responses exactly
export interface CreateModelResponse {
  success: boolean;
  id: string;
  model: ShoeModel;
  message: string;
}

export interface UpdateModelResponse {
  success: boolean;
  id: string;
  model: ShoeModel;
  message: string;
}

export interface DeleteModelResponse {
  success: boolean;
  id: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
}
