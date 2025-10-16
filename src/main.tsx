import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/app/ThemeProvider';
import { router } from '@/routes/router';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root container missing in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
