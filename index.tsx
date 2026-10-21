import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeNativeAuthRedirect } from './utils/nativeAuth';
import { registerSW } from 'virtual:pwa-register';
import { supabase } from './utils/supabase';

const AdminView = React.lazy(() => import('./views/AdminView'));
const isAdminRoute = /^\/admin(?:\/|$)/u.test(window.location.pathname);
if (isAdminRoute) registerSW({ immediate: true });
// OAuth returns to the existing allowed root callback; preserve the administrator destination.
if (!isAdminRoute) {
  try {
    const marker = Number(sessionStorage.getItem('dayflow-admin-auth-return') || 0);
    if (marker > 0 && Date.now() - marker < 10 * 60_000) {
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) { sessionStorage.removeItem('dayflow-admin-auth-return'); window.location.replace('/admin'); }
      });
    } else sessionStorage.removeItem('dayflow-admin-auth-return');
  } catch { /* Normal app navigation remains available when storage is disabled. */ }
}

void initializeNativeAuthRedirect();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isAdminRoute ? <React.Suspense fallback={<div style={{ padding: 32 }}>불러오는 중…</div>}><AdminView /></React.Suspense> : <App />}
  </React.StrictMode>
);
