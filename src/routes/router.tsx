import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from '@/components/AuthGuards';
import { Account } from '@/pages/Account';
import { About } from '@/pages/About';
import { AdminPanel } from '@/pages/AdminPanel';
import { ProjectDetails } from '@/pages/ProjectDetails';
import { TrayDetails } from '@/pages/TrayDetails';
import { Projects } from '@/pages/Projects';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Projects />
      },
      {
        path: 'about',
        element: <About />
      },
      {
        path: 'projects/:projectId',
        element: <ProjectDetails />
      },
      {
        path: 'projects/:projectId/trays/:trayId',
        element: <TrayDetails />
      },
      {
        path: 'login',
        element: (
          <RedirectIfAuthenticated>
            <Login />
          </RedirectIfAuthenticated>
        )
      },
      {
        path: 'register',
        element: (
          <RedirectIfAuthenticated>
            <Register />
          </RedirectIfAuthenticated>
        )
      },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <Account />
          </RequireAuth>
        )
      },
      {
        path: 'admin',
        element: (
          <RequireAdmin>
            <AdminPanel />
          </RequireAdmin>
        )
      }
    ]
  }
];

export const router = createBrowserRouter(routes);
