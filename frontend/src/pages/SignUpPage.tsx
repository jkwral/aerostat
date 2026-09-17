import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function SignUpPage() {
  const { signUp, confirmSignUp, signIn } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'signUp' | 'confirm'>('signUp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signUp(email, password);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await confirmSignUp(email, code);
      await signIn(email, password);
      navigate('/upload');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 'confirm') {
    return (
      <main>
        <h1>Confirm your email</h1>
        <p>Enter the verification code sent to {email}.</p>
        <form onSubmit={(event) => void handleConfirm(event)}>
          <label>
            Verification code
            <input required value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Confirming…' : 'Confirm'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign up</h1>
      <p>Restricted to @wral.com email addresses.</p>
      <form onSubmit={(event) => void handleSignUp(event)}>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password (12+ characters, upper/lowercase, digit, symbol)
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing up…' : 'Sign up'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}
