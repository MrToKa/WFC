import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/app/ThemeProvider';
import { router } from '@/routes/router';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root container missing in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>
);
