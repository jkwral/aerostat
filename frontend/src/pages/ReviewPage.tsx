import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getPlaybackUrl, submitDecision, type Decision } from '../review/api';

interface LocationState {
  status?: string;
}

export function ReviewPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { getIdToken } = useAuth();

  const initialStatus = (location.state as LocationState | null)?.status;
  const [status, setStatus] = useState(initialStatus ?? 'READY_FOR_REVIEW');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!videoId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const idToken = await getIdToken();
        const { url } = await getPlaybackUrl(idToken, videoId);
        if (!cancelled) {
          setPlaybackUrl(url);
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
  }, [videoId, getIdToken]);

  async function handleDecision(decision: Decision) {
    if (!videoId) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const idToken = await getIdToken();
      const result = await submitDecision(idToken, videoId, decision, notes || undefined);
      setStatus(result.status);
      navigate('/library');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isDecidable = status === 'READY_FOR_REVIEW';

  return (
    <main>
      <h1>{isDecidable ? 'Review video' : 'Video decision'}</h1>
      {error && <p role="alert">{error}</p>}

      {playbackUrl ? (
        <video src={playbackUrl} controls className="review-video">
          <track kind="captions" />
        </video>
      ) : (
        !error && <p>Loading video…</p>
      )}

      {isDecidable ? (
        <>
          <label>
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
          <div className="review-actions">
            <button
              type="button"
              disabled={isSubmitting || !playbackUrl}
              onClick={() => void handleDecision('approved')}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={isSubmitting || !playbackUrl}
              onClick={() => void handleDecision('rejected')}
            >
              Reject
            </button>
          </div>
        </>
      ) : (
        <p>This video has already been {status.toLowerCase()}.</p>
      )}
    </main>
  );
}
