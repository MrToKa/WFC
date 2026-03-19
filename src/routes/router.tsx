import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from '@/components/AuthGuards';
import { Account } from '@/pages/Account';
import { Assemblies } from '@/pages/Assemblies';
import { Materials } from '@/pages/Materials';
import { Templates } from '@/pages/Templates';
import { AdminPanel } from '@/pages/AdminPanel';
import { CableDetails } from '@/pages/CableDetails';
import { CableTypeDetails } from '@/pages/CableTypeDetails';
import { ProjectDetails } from '@/pages/ProjectDetails';
import { TrayDetails } from '@/pages/TrayDetails';
import { Projects } from '@/pages/Projects';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { LoadCurveDetails } from '@/pages/LoadCurveDetails';

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
        path: 'materials',
        element: <Materials />
      },
      {
        path: 'templates',
        element: (
          <RequireAuth>
            <Templates />
          </RequireAuth>
        )
      },
      {
        path: 'assemblies',
        element: (
          <RequireAuth>
            <Assemblies />
          </RequireAuth>
        )
      },
      {
        path: 'materials/load-curves/:loadCurveId',
        element: <LoadCurveDetails />
      },
      {
        path: 'projects/:projectId',
        element: <ProjectDetails />
      },
      {
        path: 'projects/:projectId/cable-types/:cableTypeId',
        element: <CableTypeDetails />
      },
      {
        path: 'projects/:projectId/cables/:cableId',
        element: <CableDetails />
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
