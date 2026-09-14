import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { RedirectIfAuthenticated, RequireAdmin, RequireCatalogAccess, RequireAuth } from '@/components/AuthGuards';

const lazyPage = <Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name,
) => lazy(async () => ({ default: (await load())[name] }));

const Account = lazyPage(() => import('@/pages/Account'), 'Account');
const Materials = lazyPage(() => import('@/pages/Materials'), 'Materials');
const Templates = lazyPage(() => import('@/pages/Templates'), 'Templates');
const AdminPanel = lazyPage(() => import('@/pages/AdminPanel'), 'AdminPanel');
const CableDetails = lazyPage(() => import('@/pages/CableDetails'), 'CableDetails');
const CableTypeDetails = lazyPage(() => import('@/pages/CableTypeDetails'), 'CableTypeDetails');
const ProjectDetails = lazyPage(() => import('@/pages/ProjectDetails'), 'ProjectDetails');
const RoxtecDetails = lazyPage(() => import('@/pages/RoxtecDetails'), 'RoxtecDetails');
const TrayDetails = lazyPage(() => import('@/pages/TrayDetails'), 'TrayDetails');
const Projects = lazyPage(() => import('@/pages/Projects'), 'Projects');
const Login = lazyPage(() => import('@/pages/Login'), 'Login');
const Register = lazyPage(() => import('@/pages/Register'), 'Register');
const LoadCurveDetails = lazyPage(() => import('@/pages/LoadCurveDetails'), 'LoadCurveDetails');
const MaterialCableTypeDetails = lazyPage(
  () => import('@/pages/MaterialCableTypeDetails'),
  'MaterialCableTypeDetails',
);
const MaterialCableInstallationMaterialDetails = lazyPage(
  () => import('@/pages/MaterialCableInstallationMaterialDetails'),
  'MaterialCableInstallationMaterialDetails',
);
const MaterialTrayInstallationMaterialDetails = lazyPage(
  () => import('@/pages/MaterialTrayInstallationMaterialDetails'),
  'MaterialTrayInstallationMaterialDetails',
);
const MaterialInstrumentDetails = lazyPage(
  () => import('@/pages/MaterialInstrumentDetails'),
  'MaterialInstrumentDetails',
);
const MaterialInstrumentInstallationMaterialDetails = lazyPage(
  () => import('@/pages/MaterialInstrumentInstallationMaterialDetails'),
  'MaterialInstrumentInstallationMaterialDetails',
);
const MaterialTrayDetails = lazyPage(
  () => import('@/pages/MaterialTrayDetails'),
  'MaterialTrayDetails',
);
const MaterialSupportDetails = lazyPage(
  () => import('@/pages/MaterialSupportDetails'),
  'MaterialSupportDetails',
);

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <RequireAuth>
            <Projects />
          </RequireAuth>
        ),
      },
      {
        path: 'materials',
        element: (
          <RequireCatalogAccess>
            <Materials />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'templates',
        element: (
          <RequireCatalogAccess>
            <Templates />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/cable-types/:cableTypeId',
        element: (
          <RequireCatalogAccess>
            <MaterialCableTypeDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/cable-installation-materials/:cableInstallationMaterialId',
        element: (
          <RequireCatalogAccess>
            <MaterialCableInstallationMaterialDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/tray-installation-materials/:trayInstallationMaterialId',
        element: (
          <RequireCatalogAccess>
            <MaterialTrayInstallationMaterialDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/instruments/:instrumentId',
        element: (
          <RequireCatalogAccess>
            <MaterialInstrumentDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/instrument-installation-materials/:instrumentInstallationMaterialId',
        element: (
          <RequireCatalogAccess>
            <MaterialInstrumentInstallationMaterialDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/trays/:trayId',
        element: (
          <RequireCatalogAccess>
            <MaterialTrayDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/supports/:supportId',
        element: (
          <RequireCatalogAccess>
            <MaterialSupportDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'materials/load-curves/:loadCurveId',
        element: (
          <RequireCatalogAccess>
            <LoadCurveDetails />
          </RequireCatalogAccess>
        ),
      },
      {
        path: 'projects/:projectId',
        element: (
          <RequireAuth>
            <ProjectDetails />
          </RequireAuth>
        ),
      },
      {
        path: 'projects/:projectId/roxtec/:roxtecId',
        element: (
          <RequireAuth>
            <RoxtecDetails />
          </RequireAuth>
        ),
      },
      {
        path: 'projects/:projectId/cable-types/:cableTypeId',
        element: (
          <RequireAuth>
            <CableTypeDetails />
          </RequireAuth>
        ),
      },
      {
        path: 'projects/:projectId/cables/:cableId',
        element: (
          <RequireAuth>
            <CableDetails />
          </RequireAuth>
        ),
      },
      {
        path: 'projects/:projectId/trays/:trayId',
        element: (
          <RequireAuth>
            <TrayDetails />
          </RequireAuth>
        ),
      },
      {
        path: 'login',
        element: (
          <RedirectIfAuthenticated>
            <Login />
          </RedirectIfAuthenticated>
        ),
      },
      {
        path: 'register',
        element: (
          <RedirectIfAuthenticated>
            <Register />
          </RedirectIfAuthenticated>
        ),
      },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <Account />
          </RequireAuth>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequireAdmin>
            <AdminPanel />
          </RequireAdmin>
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
