import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from '@/components/AuthGuards';

const lazyPage = <Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name,
) => lazy(async () => ({ default: (await load())[name] }));

const Account = lazyPage(() => import('@/pages/Account'), 'Account');
const Assemblies = lazyPage(() => import('@/pages/Assemblies'), 'Assemblies');
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
        element: <Projects />,
      },
      {
        path: 'materials',
        element: <Materials />,
      },
      {
        path: 'templates',
        element: (
          <RequireAuth>
            <Templates />
          </RequireAuth>
        ),
      },
      {
        path: 'assemblies',
        element: (
          <RequireAuth>
            <Assemblies />
          </RequireAuth>
        ),
      },
      {
        path: 'materials/cable-types/:cableTypeId',
        element: <MaterialCableTypeDetails />,
      },
      {
        path: 'materials/cable-installation-materials/:cableInstallationMaterialId',
        element: <MaterialCableInstallationMaterialDetails />,
      },
      {
        path: 'materials/tray-installation-materials/:trayInstallationMaterialId',
        element: <MaterialTrayInstallationMaterialDetails />,
      },
      {
        path: 'materials/instruments/:instrumentId',
        element: <MaterialInstrumentDetails />,
      },
      {
        path: 'materials/instrument-installation-materials/:instrumentInstallationMaterialId',
        element: <MaterialInstrumentInstallationMaterialDetails />,
      },
      {
        path: 'materials/trays/:trayId',
        element: <MaterialTrayDetails />,
      },
      {
        path: 'materials/supports/:supportId',
        element: <MaterialSupportDetails />,
      },
      {
        path: 'materials/load-curves/:loadCurveId',
        element: <LoadCurveDetails />,
      },
      {
        path: 'projects/:projectId',
        element: <ProjectDetails />,
      },
      {
        path: 'projects/:projectId/roxtec/:roxtecId',
        element: <RoxtecDetails />,
      },
      {
        path: 'projects/:projectId/cable-types/:cableTypeId',
        element: <CableTypeDetails />,
      },
      {
        path: 'projects/:projectId/cables/:cableId',
        element: <CableDetails />,
      },
      {
        path: 'projects/:projectId/trays/:trayId',
        element: <TrayDetails />,
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
