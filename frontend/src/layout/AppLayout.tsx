import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function AppLayout() {
  const { email, signOut } = useAuth();

  return (
    <>
      <div className="page-header">
        <nav className="main-nav">
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/upload">Upload</NavLink>
        </nav>
        <div className="page-header-user">
          <span>{email}</span>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <Outlet />
    </>
  );
}
