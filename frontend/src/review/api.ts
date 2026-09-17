import { apiFetch } from '../api/http';
import { REVIEW_API_BASE_URL } from '../config';

export interface VideoSummary {
  videoId: string;
  originalFileName: string;
  uploaderEmail: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type Decision = 'approved' | 'rejected';

export function listVideos(idToken: string): Promise<{ videos: VideoSummary[] }> {
  return apiFetch(REVIEW_API_BASE_URL, '/videos', idToken, { method: 'GET' });
}

export function getPlaybackUrl(idToken: string, videoId: string): Promise<{ url: string }> {
  return apiFetch(REVIEW_API_BASE_URL, `/videos/${videoId}/playback-url`, idToken, { method: 'GET' });
}

export function submitDecision(
  idToken: string,
  videoId: string,
  decision: Decision,
  notes?: string,
): Promise<{ videoId: string; status: string }> {
  return apiFetch(REVIEW_API_BASE_URL, `/videos/${videoId}/decision`, idToken, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}
