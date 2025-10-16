import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@fluentui/react-components';
import { useAuth } from '@/context/AuthContext';

export const RequireAuth = ({ children }: { children: ReactElement }): ReactElement => {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
        <Spinner label="Loading account..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
};

export const RequireAdmin = ({ children }: { children: ReactElement }): ReactElement => {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
        <Spinner label="Loading admin access..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!user.isAdmin) {
    return <Navigate to="/account" replace state={{ from: location.pathname }} />;
  }

  return children;
};

export const RedirectIfAuthenticated = ({
  children
}: {
  children: ReactElement;
}): ReactElement => {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
        <Spinner label="Loading..." />
      </div>
    );
  }

  if (user) {
    const redirectTo = (location.state as { from?: string } | undefined)?.from ?? '/account';
    return <Navigate to={redirectTo} replace />;
  }

  return children;
};
