import type { ReactNode } from 'react';
import { invalidateViewerLogin, revokeViewerLogin, type RevokeOutcome } from '@/viewer/loginLifecycle';
import { readStoredToken, TOKEN_STORAGE_KEY } from '@/api/session';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ApiError,
  User,
  deleteCurrentUser,
  fetchCurrentUser,
  loginUser,
  registerUser,
  updateCurrentUser,
} from '@/api/client';

type Credentials = {
  email: string;
  password: string;
};

type Registration = Credentials & {
  firstName?: string;
  lastName?: string;
};

type ProfileUpdate = {
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
};

type AuthContextValue = {
  user: User | null;
  token: string | null;
  initializing: boolean;
  viewerLogoutStatus: RevokeOutcome | 'pending' | null;
  signIn: (credentials: Credentials) => Promise<void>;
  signUp: (input: Registration) => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
  updateProfile: (input: ProfileUpdate) => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const clearRecalculationIntent = (): void => {
  try { window.sessionStorage.removeItem('wfc.pathfinder.recalculation.pending.v1'); window.sessionStorage.removeItem('wfc.pathfinder.calculation-grant.pending.v1'); } catch { /* Storage may be unavailable. */ }
};

const persistToken = (token: string | null): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<User | null>(null);
  const currentUser = useRef<User | null>(null);
  const setUser = useCallback((value: User | null) => {
    const previous=currentUser.current;
    if (previous && (previous.id!==value?.id || previous.isAdmin && !value?.isAdmin)) clearRecalculationIntent();
    currentUser.current=value;setUserState(value);
  }, []);
  const [token, setTokenState] = useState<string | null>(() => readStoredToken());
  const [initializing, setInitializing] = useState(true);
  const [viewerLogoutStatus, setViewerLogoutStatus] = useState<RevokeOutcome | 'pending' | null>(null);
  const currentToken = useRef(token);
  const authOperation = useRef(0);

  const setToken = useCallback((value: string | null) => {
    const previousToken = currentToken.current;
    if (currentToken.current !== value) {invalidateViewerLogin(currentToken.current);clearRecalculationIntent();}
    currentToken.current = value;
    setTokenState(value);
    if (value !== null || readStoredToken() === previousToken) persistToken(value);
  }, []);

  const refreshUser = useCallback(async () => {
    const operation = authOperation.current;
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const response = await fetchCurrentUser(token);
      if (currentToken.current !== token || authOperation.current !== operation) return;
      setUser(response.user);
    } catch (error) {
      if (currentToken.current !== token || authOperation.current !== operation) return;
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setToken(null);
      } else {
        throw error;
      }
    }
  }, [token, setToken]);

  useEffect(() => {
    let isMounted = true;
    const operation = authOperation.current;

    const initialise = async (): Promise<void> => {
      if (!token) {
        setInitializing(false);
        return;
      }

      try {
        const response = await fetchCurrentUser(token);
        if (isMounted && currentToken.current === token && authOperation.current === operation) {
          setUser(response.user);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (isMounted && currentToken.current === token && authOperation.current === operation) {
            setToken(null);
            setUser(null);
          }
        } else {
          console.error('Failed to initialise auth', error);
        }
      } finally {
        if (isMounted) {
          setInitializing(false);
        }
      }
    };

    void initialise();

    return () => {
      isMounted = false;
    };
  }, [token, setToken]);

  const signIn = useCallback(
    async (credentials: Credentials) => {
      const operation = ++authOperation.current;
      const result = await loginUser(credentials);
      if (authOperation.current !== operation) return;
      setUser(result.user);
      setToken(result.token);
    },
    [setToken],
  );

  const signUp = useCallback(
    async (input: Registration) => {
      const operation = ++authOperation.current;
      const result = await registerUser(input);
      if (authOperation.current !== operation) return;
      setUser(result.user);
      setToken(result.token);
    },
    [setToken],
  );

  const signOut = useCallback(() => {
    try { window.sessionStorage.removeItem('wfc.pathfinder.recalculation.pending.v1'); window.sessionStorage.removeItem('wfc.pathfinder.calculation-grant.pending.v1'); } catch { /* No stored intent may retain authority; server checks still apply. */ }
    const oldToken = currentToken.current;
    const operation = ++authOperation.current;
    invalidateViewerLogin(oldToken);
    if (oldToken) {
      setViewerLogoutStatus('pending');
      // Capture the old credential before clearing it. No late result can restore login.
      void revokeViewerLogin(oldToken).then((outcome) => {
        if (authOperation.current === operation) setViewerLogoutStatus(outcome);
      });
    }
    setUser(null);
    setToken(null);
  }, [setToken]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // Tabs with an independent login are not revoked by another login's logout.
      if (event.key !== TOKEN_STORAGE_KEY || !event.oldValue || event.oldValue !== currentToken.current || event.newValue === event.oldValue) return;
      try { window.sessionStorage.removeItem('wfc.pathfinder.recalculation.pending.v1'); window.sessionStorage.removeItem('wfc.pathfinder.calculation-grant.pending.v1'); } catch { /* Storage may be unavailable. */ }
      ++authOperation.current;
      invalidateViewerLogin(currentToken.current);
      currentToken.current = null;
      setTokenState(null);
      setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateProfileAction = useCallback(
    async (input: ProfileUpdate) => {
      const operation = authOperation.current;
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await updateCurrentUser(token, input);
      if (currentToken.current !== token || authOperation.current !== operation) return;
      setUser(response.user);
    },
    [token],
  );

  const deleteAccountAction = useCallback(async () => {
    const operation = authOperation.current;
    if (!token) {
      return;
    }

    await deleteCurrentUser(token);
    if (currentToken.current === token && authOperation.current === operation) signOut();
  }, [token, signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      initializing,
      viewerLogoutStatus,
      signIn,
      signUp,
      signOut,
      refreshUser,
      updateProfile: updateProfileAction,
      deleteAccount: deleteAccountAction,
    }),
    [
      user,
      token,
      initializing,
      viewerLogoutStatus,
      signIn,
      signUp,
      signOut,
      refreshUser,
      updateProfileAction,
      deleteAccountAction,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
