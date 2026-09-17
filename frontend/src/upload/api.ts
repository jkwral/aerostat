import { apiFetch } from '../api/http';
import { UPLOAD_API_BASE_URL } from '../config';

export interface InitiateUploadResponse {
  videoId: string;
  s3Key: string;
  partSizeBytes: number;
  partCount: number;
}

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export function initiateUpload(idToken: string, file: File): Promise<InitiateUploadResponse> {
  return apiFetch(UPLOAD_API_BASE_URL, '/uploads', idToken, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'video/mp4',
      sizeBytes: file.size,
    }),
  });
}

export function signPart(idToken: string, videoId: string, partNumber: number): Promise<{ url: string }> {
  return apiFetch(UPLOAD_API_BASE_URL, `/uploads/${videoId}/parts/${partNumber}`, idToken, { method: 'POST' });
}

export function completeUpload(
  idToken: string,
  videoId: string,
  parts: CompletedPart[],
): Promise<{ videoId: string; status: string }> {
  return apiFetch(UPLOAD_API_BASE_URL, `/uploads/${videoId}/complete`, idToken, {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
}

export async function abortUpload(idToken: string, videoId: string): Promise<void> {
  await apiFetch(UPLOAD_API_BASE_URL, `/uploads/${videoId}/abort`, idToken, { method: 'POST' });
}
