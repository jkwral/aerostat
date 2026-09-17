import { API_BASE_URL } from '../config';

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

async function apiFetch<T>(path: string, idToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // API Gateway's Cognito User Pools authorizer expects the raw ID
      // token in this header, with no "Bearer " prefix.
      Authorization: idToken,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed with status ${response.status}: ${body}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function initiateUpload(idToken: string, file: File): Promise<InitiateUploadResponse> {
  return apiFetch('/uploads', idToken, {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'video/mp4',
      sizeBytes: file.size,
    }),
  });
}

export function signPart(idToken: string, videoId: string, partNumber: number): Promise<{ url: string }> {
  return apiFetch(`/uploads/${videoId}/parts/${partNumber}`, idToken, { method: 'POST' });
}

export function completeUpload(
  idToken: string,
  videoId: string,
  parts: CompletedPart[],
): Promise<{ videoId: string; status: string }> {
  return apiFetch(`/uploads/${videoId}/complete`, idToken, {
    method: 'POST',
    body: JSON.stringify({ parts }),
  });
}

export async function abortUpload(idToken: string, videoId: string): Promise<void> {
  await apiFetch(`/uploads/${videoId}/abort`, idToken, { method: 'POST' });
}
