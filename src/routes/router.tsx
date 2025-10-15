import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { About } from '@/pages/About';
import { Home } from '@/pages/Home';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Home />
      },
      {
        path: 'about',
        element: <About />
      }
    ]
  }
];

export const router = createBrowserRouter(routes);
