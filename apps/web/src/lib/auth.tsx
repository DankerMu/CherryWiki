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
import { ApiError, api, configureApiClient } from './api';

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
  refreshUser: () => Promise<void>;
  isBootstrapping: boolean;
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
let bootstrapRefreshPromise: Promise<TokenPairResponse> | null = null;

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(initialSession?.user ?? null);
  const [accessToken, setAccessTokenState] = useState<string | null>(initialSession?.accessToken ?? null);
  const [isBootstrapping, setIsBootstrapping] = useState(initialSession === undefined);
  const accessTokenRef = useRef<string | null>(initialSession?.accessToken ?? null);
  const refreshTimerRef = useRef<number | undefined>(undefined);
  const isBootstrappingRef = useRef(initialSession === undefined);
  const bootstrapRefreshInFlightRef = useRef(false);
  const sessionGenRef = useRef(0);

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
    sessionGenRef.current += 1;
    clearRefreshTimer();
    setAccessToken(null);
    setUser(null);
  }, [clearRefreshTimer, setAccessToken]);

  const setBootstrapping = useCallback((nextValue: boolean) => {
    isBootstrappingRef.current = nextValue;
    setIsBootstrapping(nextValue);
  }, []);

  const refresh = useCallback(async () => {
    const tokenPair = await api.post<TokenPairResponse>('/auth/refresh');
    setAccessToken(tokenPair.access_token);
    scheduleRefresh(tokenPair.expires_in, refreshTimerRef, refresh);
  }, [setAccessToken]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      sessionGenRef.current += 1;
      const result = await api.post<LoginResponse>('/auth/login', { email, password });
      setAccessToken(result.access_token);
      scheduleRefresh(result.expires_in, refreshTimerRef, refresh);
      try {
        const me = await api.get<CurrentUserResponse>('/auth/me');
        const enriched: AuthUser = { ...result.user, spaces: me.spaces };
        setUser(enriched);
        setBootstrapping(false);
        return enriched;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          setBootstrapping(false);
          throw err;
        }

        setUser(result.user);
        setBootstrapping(false);
        return result.user;
      }
    },
    [clearSession, refresh, setAccessToken, setBootstrapping],
  );

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get<CurrentUserResponse>('/auth/me');
      setUser({ ...me, spaces: me.spaces });
    } catch {
      // On 401 the API client's onUnauthorized handler already clears the
      // session — restoring stale state here would fight that. For any other
      // error the existing user/token remain untouched because we never
      // overwrite them before the fetch succeeds.
    }
  }, []);

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
        if (isBootstrappingRef.current || bootstrapRefreshInFlightRef.current) {
          return;
        }

        clearSession();
        void navigate('/login', { replace: true });
      },
    });
  }, [clearSession, navigate]);

  useEffect(() => {
    if (initialSession?.accessToken !== undefined) {
      setBootstrapping(false);
      scheduleRefresh(initialSession.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS, refreshTimerRef, refresh);
      return () => {
        clearRefreshTimer();
      };
    }

    let isCancelled = false;

    async function bootstrapSession(): Promise<void> {
      setBootstrapping(true);
      const gen = sessionGenRef.current;

      try {
        bootstrapRefreshInFlightRef.current = true;
        let tokenPair: TokenPairResponse;
        try {
          tokenPair = await getBootstrapRefreshTokenPair();
        } finally {
          bootstrapRefreshInFlightRef.current = false;
        }

        if (isCancelled || sessionGenRef.current !== gen) {
          return;
        }

        setAccessToken(tokenPair.access_token);
        scheduleRefresh(tokenPair.expires_in, refreshTimerRef, refresh);

        const me = await api.get<CurrentUserResponse>('/auth/me');
        if (isCancelled || sessionGenRef.current !== gen) {
          return;
        }
        setUser({ ...me, spaces: me.spaces });
      } catch {
        if (!isCancelled && sessionGenRef.current === gen) {
          clearSession();
        }
      } finally {
        if (!isCancelled) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrapSession();

    return () => {
      isCancelled = true;
      clearRefreshTimer();
    };
  }, [clearRefreshTimer, clearSession, initialSession?.accessToken, initialSession?.expiresIn, refresh, setBootstrapping]);

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
      refreshUser,
      isBootstrapping,
      isAuthenticated: accessToken !== null && user !== null,
      isAdmin: user !== null && isAdminRole(user.role),
      hasSpacePermission,
    }),
    [accessToken, hasSpacePermission, isBootstrapping, login, logout, refresh, refreshUser, user],
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

function getBootstrapRefreshTokenPair(): Promise<TokenPairResponse> {
  if (bootstrapRefreshPromise === null) {
    bootstrapRefreshPromise = api.post<TokenPairResponse>('/auth/refresh').finally(() => {
      bootstrapRefreshPromise = null;
    });
  }

  return bootstrapRefreshPromise;
}
