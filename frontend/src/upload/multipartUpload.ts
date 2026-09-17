import { abortUpload, completeUpload, initiateUpload, signPart, type CompletedPart } from './api';
import { Semaphore } from './semaphore';

// Per DECISIONS.md: at this project's scale, a simple client-side cap of a
// few parts in parallel per file is sufficient (the file-level cap of 5
// lives in UploadPage, alongside the rest of the upload queue UI).
const MAX_CONCURRENT_PARTS_PER_FILE = 4;

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
}

function uploadPartToUrl(url: string, blob: Blob, onLoaded: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onLoaded(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = xhr.getResponseHeader('ETag');
        if (!eTag) {
          reject(new Error('S3 did not return an ETag for the uploaded part.'));
          return;
        }
        resolve(eTag);
      } else {
        reject(new Error(`Part upload failed with status ${xhr.status}.`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading part.'));
    xhr.send(blob);
  });
}

export async function uploadFile(
  idToken: string,
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<void> {
  const { videoId, partSizeBytes, partCount } = await initiateUpload(idToken, file);

  const loadedByPart = new Array<number>(partCount).fill(0);
  const reportProgress = () => {
    onProgress({
      loadedBytes: loadedByPart.reduce((sum, loaded) => sum + loaded, 0),
      totalBytes: file.size,
    });
  };

  const partSemaphore = new Semaphore(MAX_CONCURRENT_PARTS_PER_FILE);

  try {
    const parts: CompletedPart[] = await Promise.all(
      Array.from({ length: partCount }, (_, index) => index + 1).map(async (partNumber) => {
        await partSemaphore.acquire();
        try {
          const start = (partNumber - 1) * partSizeBytes;
          const blob = file.slice(start, Math.min(start + partSizeBytes, file.size));

          const { url } = await signPart(idToken, videoId, partNumber);
          const eTag = await uploadPartToUrl(url, blob, (loaded) => {
            loadedByPart[partNumber - 1] = loaded;
            reportProgress();
          });
          return { partNumber, eTag };
        } finally {
          partSemaphore.release();
        }
      }),
    );

    await completeUpload(idToken, videoId, parts);
  } catch (err) {
    await abortUpload(idToken, videoId).catch(() => undefined);
    throw err;
  }
}
