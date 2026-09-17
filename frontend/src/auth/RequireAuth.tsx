import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { email, isLoading } = useAuth();

  if (isLoading) {
    return <p>Loading…</p>;
  }
  if (!email) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
