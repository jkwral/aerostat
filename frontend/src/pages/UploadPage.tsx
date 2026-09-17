import { useState, type ChangeEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { uploadFile } from '../upload/multipartUpload';
import { Semaphore } from '../upload/semaphore';

// Per DECISIONS.md scale assumptions: ≤5 concurrent uploads is plenty.
const MAX_CONCURRENT_FILES = 5;
const fileSemaphore = new Semaphore(MAX_CONCURRENT_FILES);

type UploadStatus = 'queued' | 'uploading' | 'done' | 'error';

interface FileUploadState {
  id: string;
  file: File;
  loadedBytes: number;
  status: UploadStatus;
  error?: string;
}

export function UploadPage() {
  const { email, signOut, getIdToken } = useAuth();
  const [uploads, setUploads] = useState<FileUploadState[]>([]);

  function patchUpload(id: string, patch: Partial<FileUploadState>) {
    setUploads((prev) => prev.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)));
  }

  function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    const newUploads: FileUploadState[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      loadedBytes: 0,
      status: 'queued',
    }));
    setUploads((prev) => [...prev, ...newUploads]);

    for (const { id, file } of newUploads) {
      void (async () => {
        await fileSemaphore.acquire();
        patchUpload(id, { status: 'uploading' });
        try {
          const idToken = await getIdToken();
          await uploadFile(idToken, file, ({ loadedBytes }) => patchUpload(id, { loadedBytes }));
          patchUpload(id, { status: 'done', loadedBytes: file.size });
        } catch (err) {
          patchUpload(id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        } finally {
          fileSemaphore.release();
        }
      })();
    }
  }

  return (
    <main>
      <div className="page-header">
        <p>Signed in as {email}</p>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <h1>Upload video for review</h1>
      <input type="file" accept="video/*" multiple onChange={handleFilesSelected} />

      <ul className="upload-list">
        {uploads.map((upload) => {
          const percent = upload.file.size === 0 ? 0 : Math.round((upload.loadedBytes / upload.file.size) * 100);
          return (
            <li key={upload.id}>
              <div className="upload-row">
                <span>{upload.file.name}</span>
                <span className={upload.status === 'error' ? 'status-error' : undefined}>
                  {upload.status === 'error' ? upload.error : `${upload.status} · ${percent}%`}
                </span>
              </div>
              <progress value={percent} max={100} />
            </li>
          );
        })}
      </ul>
    </main>
  );
}
