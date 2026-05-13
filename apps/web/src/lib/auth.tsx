import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { api, configureApiClient } from './api';

export type SpaceRole = 'viewer' | 'editor' | 'admin';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  groups: string[] | Array<{ id: string; name: string }>;
  spaces?: Array<{ id: string; name: string; role: SpaceRole }>;
};

type LoginResponse = {
  access_token: string;
  expires_in: number;
  user: AuthUser;
};

type CurrentUserResponse = {
  id: string;
  email: string;
  name: string;
  role: string;
  groups: Array<{ id: string; name: string }>;
  spaces: Array<{ id: string; name: string; role: SpaceRole }>;
};

type TokenPairResponse = {
  access_token: string;
  expires_in: number;
};

type AuthContextValue = {
  user: AuthUser | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasSpacePermission: (spaceId: string, permission: string) => boolean;
};

type InitialSession = {
  user: AuthUser;
  accessToken: string;
  expiresIn?: number;
};

export type AuthProviderProps = {
  children: ReactNode;
  initialSession?: InitialSession;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const REFRESH_LEEWAY_SECONDS = 5 * 60;
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60;

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(initialSession?.user ?? null);
  const [accessToken, setAccessTokenState] = useState<string | null>(initialSession?.accessToken ?? null);
  const accessTokenRef = useRef<string | null>(initialSession?.accessToken ?? null);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== undefined) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = undefined;
    }
  }, []);

  const setAccessToken = useCallback((nextToken: string | null) => {
    accessTokenRef.current = nextToken;
    setAccessTokenState(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    clearRefreshTimer();
    setAccessToken(null);
    setUser(null);
  }, [clearRefreshTimer, setAccessToken]);

  const refresh = useCallback(async () => {
    const tokenPair = await api.post<TokenPairResponse>('/auth/refresh');
    setAccessToken(tokenPair.access_token);
    scheduleRefresh(tokenPair.expires_in, refreshTimerRef, refresh);
  }, [setAccessToken]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const result = await api.post<LoginResponse>('/auth/login', { email, password });
      setAccessToken(result.access_token);
      scheduleRefresh(result.expires_in, refreshTimerRef, refresh);
      try {
        const me = await api.get<CurrentUserResponse>('/auth/me');
        const enriched: AuthUser = { ...result.user, spaces: me.spaces };
        setUser(enriched);
        return enriched;
      } catch {
        setUser(result.user);
        return result.user;
      }
    },
    [refresh, setAccessToken],
  );

  const logout = useCallback(async () => {
    try {
      await api.post<{ success: true }>('/auth/logout');
    } catch {
      // Local session state must still be cleared if server-side logout fails.
    } finally {
      clearSession();
      void navigate('/login', { replace: true });
    }
  }, [clearSession, navigate]);

  useEffect(() => {
    configureApiClient({
      getAccessToken: () => accessTokenRef.current,
      onUnauthorized: () => {
        clearSession();
        void navigate('/login', { replace: true });
      },
    });
  }, [clearSession, navigate]);

  useEffect(() => {
    if (initialSession?.accessToken !== undefined) {
      scheduleRefresh(initialSession.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS, refreshTimerRef, refresh);
    }

    return () => {
      clearRefreshTimer();
    };
  }, [clearRefreshTimer, initialSession?.accessToken, initialSession?.expiresIn, refresh]);

  const hasSpacePermission = useCallback(
    (spaceId: string, permission: string): boolean => checkSpacePermission(user, spaceId, permission),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      login,
      logout,
      refresh,
      isAuthenticated: accessToken !== null && user !== null,
      isAdmin: user !== null && isAdminRole(user.role),
      hasSpacePermission,
    }),
    [accessToken, hasSpacePermission, login, logout, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}

export function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'owner';
}

const SPACE_ROLE_PERMISSIONS: Record<SpaceRole, readonly string[]> = {
  viewer: ['space:read', 'space:view', 'upload:read', 'chat:use', 'model:use'],
  editor: [
    'space:read',
    'space:view',
    'space:edit',
    'upload:create',
    'upload:read',
    'wiki:publish',
    'graphify:run',
    'graphify:view',
    'chat:use',
    'model:use',
  ],
  admin: [
    'space:read',
    'space:view',
    'space:edit',
    'space:admin',
    'upload:create',
    'upload:read',
    'wiki:publish',
    'wiki:rollback',
    'graphify:run',
    'graphify:view',
    'chat:use',
    'model:use',
  ],
};

function checkSpacePermission(user: AuthUser | null, spaceId: string, permission: string): boolean {
  if (user === null) return false;
  if (user.role === 'owner') return true;
  if (user.role === 'admin') return true;
  const space = user.spaces?.find((s) => s.id === spaceId);
  if (space === undefined) return false;
  return SPACE_ROLE_PERMISSIONS[space.role]?.includes(permission) === true;
}

function scheduleRefresh(
  expiresIn: number,
  timerRef: React.MutableRefObject<number | undefined>,
  refresh: () => Promise<void>,
): void {
  if (timerRef.current !== undefined) {
    window.clearTimeout(timerRef.current);
  }

  const delaySeconds = Math.max(0, expiresIn - REFRESH_LEEWAY_SECONDS);
  timerRef.current = window.setTimeout(() => {
    void refresh().catch(() => undefined);
  }, delaySeconds * 1000);
}
