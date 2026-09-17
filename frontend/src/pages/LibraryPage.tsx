import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { listVideos, type VideoSummary } from '../review/api';

const REVIEWABLE_STATUSES = new Set(['READY_FOR_REVIEW', 'APPROVED', 'REJECTED']);

function formatStatus(status: string): string {
  return status.replaceAll('_', ' ').toLowerCase();
}

export function LibraryPage() {
  const { getIdToken } = useAuth();
  const [videos, setVideos] = useState<VideoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idToken = await getIdToken();
        const { videos: fetched } = await listVideos(idToken);
        if (!cancelled) {
          setVideos(fetched);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  return (
    <main>
      <h1>Library</h1>
      {error && <p role="alert">{error}</p>}
      {!videos && !error && <p>Loading…</p>}
      {videos && videos.length === 0 && <p>No uploads yet.</p>}
      {videos && videos.length > 0 && (
        <table className="video-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Uploaded by</th>
              <th>Status</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.videoId}>
                <td>{video.originalFileName}</td>
                <td>{video.uploaderEmail}</td>
                <td>{formatStatus(video.status)}</td>
                <td>{new Date(video.updatedAt).toLocaleString()}</td>
                <td>
                  {REVIEWABLE_STATUSES.has(video.status) && (
                    <Link to={`/library/${video.videoId}`} state={{ status: video.status }}>
                      {video.status === 'READY_FOR_REVIEW' ? 'Review' : 'View'}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
