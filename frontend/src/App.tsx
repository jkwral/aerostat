import { Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';
import { UploadPage } from './pages/UploadPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/upload" element={<UploadPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/upload" replace />} />
    </Routes>
  );
}
