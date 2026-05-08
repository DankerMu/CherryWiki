import {
  ApartmentOutlined,
  AuditOutlined,
  BookOutlined,
  BulbOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  HeartOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoonOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Breadcrumb,
  Button,
  Empty,
  Layout,
  Menu,
  Segmented,
  Select,
  Space,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth, type AuthUser } from '../lib/auth';
import { useTheme } from '../theme/ThemeProvider';
import './AppShell.css';

type SpaceFunction = 'chat' | 'wiki' | 'uploads' | 'graphify';
type AdminRouteKey = 'users' | 'groups' | 'spaces' | 'models' | 'audit' | 'health' | 'jobs' | 'adminGraphify';

const SIDER_STORAGE_KEY = 'cherrywiki.shell.collapsed';

const SPACE_FUNCTIONS: Array<{
  key: SpaceFunction;
  icon: ReactNode;
  translationKey: string;
}> = [
  { key: 'chat', icon: <MessageOutlined />, translationKey: 'shell.sidebar.chat' },
  { key: 'wiki', icon: <BookOutlined />, translationKey: 'shell.sidebar.wiki' },
  { key: 'uploads', icon: <CloudUploadOutlined />, translationKey: 'shell.sidebar.uploads' },
  { key: 'graphify', icon: <NodeIndexOutlined />, translationKey: 'shell.sidebar.graphify' },
];

const ADMIN_ROUTES: Array<{
  key: AdminRouteKey;
  path: string;
  icon: ReactNode;
  translationKey: string;
}> = [
  { key: 'users', path: '/admin/users', icon: <UserOutlined />, translationKey: 'shell.admin.users' },
  { key: 'groups', path: '/admin/groups', icon: <TeamOutlined />, translationKey: 'shell.admin.groups' },
  { key: 'spaces', path: '/admin/spaces', icon: <ApartmentOutlined />, translationKey: 'shell.admin.spaces' },
  { key: 'models', path: '/admin/models', icon: <DatabaseOutlined />, translationKey: 'shell.admin.models' },
  { key: 'audit', path: '/admin/audit', icon: <AuditOutlined />, translationKey: 'shell.admin.audit' },
  { key: 'health', path: '/admin/health', icon: <HeartOutlined />, translationKey: 'shell.admin.health' },
  { key: 'jobs', path: '/admin/jobs', icon: <HistoryOutlined />, translationKey: 'shell.admin.jobs' },
  { key: 'adminGraphify', path: '/admin/graphify', icon: <NodeIndexOutlined />, translationKey: 'shell.admin.graphify' },
];

export default function AppShell() {
  const { t } = useTranslation();
  const { user, isAdmin, logout } = useAuth();
  const { themeMode, language, setLanguage, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { spaceId: routeSpaceId } = useParams();
  const [collapsed, setCollapsed] = useState(() => safeReadBoolean(SIDER_STORAGE_KEY, false));

  const spaces = useMemo(() => user?.spaces ?? [], [user?.spaces]);
  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === routeSpaceId) ?? spaces[0],
    [routeSpaceId, spaces],
  );
  const selectedSpaceId = selectedSpace?.id;
  const selectedSpaceFunction = getSpaceFunctionFromPath(location.pathname);
  const selectedAdminKey = getAdminRouteKey(location.pathname);

  const menuItems = useMemo<NonNullable<MenuProps['items']>>(() => {
    const spaceItems =
      selectedSpaceId === undefined
        ? []
        : SPACE_FUNCTIONS.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: t(item.translationKey),
          }));

    const adminItems = isAdmin
      ? [
          {
            key: 'admin',
            icon: <SettingOutlined />,
            label: t('shell.admin.section'),
            children: ADMIN_ROUTES.map((item) => ({
              key: `admin:${item.key}`,
              icon: item.icon,
              label: t(item.translationKey),
            })),
          },
        ]
      : [];

    return [...spaceItems, ...adminItems];
  }, [isAdmin, selectedSpaceId, t]);

  const selectedKeys = useMemo(() => {
    if (selectedAdminKey !== null) {
      return [`admin:${selectedAdminKey}`];
    }

    if (selectedSpaceFunction !== null) {
      return [selectedSpaceFunction];
    }

    return [];
  }, [selectedAdminKey, selectedSpaceFunction]);

  const breadcrumbItems = useMemo(
    () => buildBreadcrumbItems(location.pathname, selectedSpace?.name, t),
    [location.pathname, selectedSpace?.name, t],
  );

  function handleCollapse(nextCollapsed: boolean): void {
    try {
      setCollapsed(nextCollapsed);
      safeWriteBoolean(SIDER_STORAGE_KEY, nextCollapsed);
    } catch {
      // The visual state remains controlled by React if persistence fails.
    }
  }

  const handleMenuClick: MenuProps['onClick'] = (event) => {
    try {
      const key = String(event.key);
      if (isSpaceFunction(key)) {
        if (selectedSpaceId !== undefined) {
          void navigate(`/spaces/${encodeURIComponent(selectedSpaceId)}/${key}`);
        }
        return;
      }

      if (key.startsWith('admin:')) {
        const route = ADMIN_ROUTES.find((item) => `admin:${item.key}` === key);
        if (route !== undefined) {
          void navigate(route.path);
        }
      }
    } catch {
      // Navigation callbacks should not break shell rendering.
    }
  };

  function handleSpaceChange(nextSpaceId: string): void {
    try {
      const nextFunction = selectedSpaceFunction ?? 'chat';
      void navigate(`/spaces/${encodeURIComponent(nextSpaceId)}/${nextFunction}`);
    } catch {
      // Keep the current route if navigation fails.
    }
  }

  function handleLanguageChange(nextLanguage: string | number): void {
    try {
      setLanguage(nextLanguage === 'en' ? 'en' : 'zh-CN');
    } catch {
      // Keep the current language if the provider rejects the update.
    }
  }

  function handleThemeToggle(): void {
    try {
      toggleTheme();
    } catch {
      // Keep the current theme if the provider rejects the update.
    }
  }

  function handleLogout(): void {
    void logout().catch(() => undefined);
  }

  const nextThemeLabel =
    themeMode === 'dark' ? t('shell.control.theme.light') : t('shell.control.theme.dark');

  return (
    <Layout className={`app-shell${collapsed ? ' app-shell-collapsed' : ''}`}>
      <Layout.Sider
        className="app-shell-sider"
        collapsed={collapsed}
        collapsedWidth={72}
        collapsible
        trigger={null}
        width={264}
      >
        <div className="app-shell-brand">
          <span className="app-shell-brand-mark">C</span>
          {!collapsed ? (
            <span className="app-shell-brand-text">
              <strong>{t('common.app.name')}</strong>
              <span>{t('shell.brand.adminConsole')}</span>
            </span>
          ) : null}
        </div>

        {!collapsed ? (
          <div className="app-shell-space-select">
            <Typography.Text type="secondary">{t('shell.space.selectorLabel')}</Typography.Text>
            <Select
              aria-label={t('shell.space.selectorLabel')}
              disabled={spaces.length === 0}
              onChange={handleSpaceChange}
              options={spaces.map((space) => ({ value: space.id, label: space.name }))}
              placeholder={t('shell.space.empty')}
              value={selectedSpaceId ?? null}
              style={{ width: '100%', marginTop: 6 }}
            />
          </div>
        ) : null}

        {spaces.length === 0 && !collapsed ? (
          <div className="app-shell-empty-space">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('shell.space.empty')} />
          </div>
        ) : null}

        <Menu
          className="app-shell-menu"
          defaultOpenKeys={['admin']}
          items={menuItems}
          mode="inline"
          onClick={handleMenuClick}
          selectedKeys={selectedKeys}
        />

        <div className="app-shell-bottom">
          {!collapsed ? (
            <div className="app-shell-controls">
              <Segmented
                aria-label={t('shell.control.language.label')}
                onChange={handleLanguageChange}
                options={[
                  { label: t('shell.control.language.zh'), value: 'zh-CN' },
                  { label: t('shell.control.language.en'), value: 'en' },
                ]}
                size="small"
                value={language}
              />
              <Tooltip title={nextThemeLabel}>
                <Button
                  aria-label={nextThemeLabel}
                  icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                  onClick={handleThemeToggle}
                  type="text"
                />
              </Tooltip>
              <Tooltip title={t('shell.control.collapse')}>
                <Button
                  aria-label={t('shell.control.collapse')}
                  icon={<MenuFoldOutlined />}
                  onClick={() => handleCollapse(true)}
                  type="text"
                />
              </Tooltip>
            </div>
          ) : (
            <Space direction="vertical" align="center">
              <Tooltip title={nextThemeLabel}>
                <Button
                  aria-label={nextThemeLabel}
                  icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                  onClick={handleThemeToggle}
                  type="text"
                />
              </Tooltip>
              <Tooltip title={t('shell.control.expand')}>
                <Button
                  aria-label={t('shell.control.expand')}
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => handleCollapse(false)}
                  type="text"
                />
              </Tooltip>
            </Space>
          )}

          <div className="app-shell-user">
            <Avatar icon={<UserOutlined />} size="small" />
            {!collapsed ? (
              <span className="app-shell-user-text">
                <strong>{user?.name ?? user?.email ?? t('shell.user.profile')}</strong>
                <span>{getRoleLabel(user, t)}</span>
              </span>
            ) : null}
            <Tooltip title={t('common.action.logout')}>
              <Button
                aria-label={t('common.action.logout')}
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                type="text"
              />
            </Tooltip>
          </div>
        </div>
      </Layout.Sider>

      <Layout>
        <Layout.Header className="app-shell-header">
          <Breadcrumb items={breadcrumbItems} />
          <Space className="app-shell-header-user" size="small">
            <BulbOutlined />
            <span>{user?.name ?? user?.email ?? t('shell.user.profile')}</span>
            <Typography.Text type="secondary">{getRoleLabel(user, t)}</Typography.Text>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-shell-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function getRoleLabel(user: AuthUser | null, t: (key: string) => string): string {
  const role = user?.role ?? 'unknown';
  return t(`common.role.${role}`);
}

function isSpaceFunction(key: string): key is SpaceFunction {
  return SPACE_FUNCTIONS.some((item) => item.key === key);
}

function getSpaceFunctionFromPath(pathname: string): SpaceFunction | null {
  if (pathname.includes('/wiki')) return 'wiki';
  if (pathname.includes('/uploads')) return 'uploads';
  if (pathname.includes('/graphify')) return 'graphify';
  if (pathname.includes('/chat')) return 'chat';
  return null;
}

function getAdminRouteKey(pathname: string): AdminRouteKey | null {
  if (!pathname.startsWith('/admin')) {
    return null;
  }

  if (pathname.startsWith('/admin/groups')) return 'groups';
  if (pathname.startsWith('/admin/spaces')) return 'spaces';
  if (pathname.startsWith('/admin/models')) return 'models';
  if (pathname.startsWith('/admin/audit')) return 'audit';
  if (pathname.startsWith('/admin/health')) return 'health';
  if (pathname.startsWith('/admin/jobs')) return 'jobs';
  if (pathname.startsWith('/admin/graphify')) return 'adminGraphify';
  return 'users';
}

function buildBreadcrumbItems(pathname: string, spaceName: string | undefined, t: (key: string) => string) {
  const adminKey = getAdminRouteKey(pathname);
  if (adminKey !== null) {
    const adminRoute = ADMIN_ROUTES.find((item) => item.key === adminKey);
    const items = [
      { title: t('shell.header.breadcrumb.admin') },
      { title: adminRoute === undefined ? t('shell.admin.users') : t(adminRoute.translationKey) },
    ];

    if (/\/admin\/jobs\/[^/]+/.test(pathname)) {
      items.push({ title: t('shell.header.breadcrumb.detail') });
    }

    return items;
  }

  const spaceFunction = getSpaceFunctionFromPath(pathname);
  if (spaceFunction !== null) {
    const item = SPACE_FUNCTIONS.find((candidate) => candidate.key === spaceFunction);
    const items = [
      { title: spaceName ?? t('shell.space.selectorLabel') },
      { title: item === undefined ? t('shell.sidebar.chat') : t(item.translationKey) },
    ];

    const pathParts = pathname.split('/').filter(Boolean);
    if (pathParts.length > 3) {
      items.push({ title: t('shell.header.breadcrumb.detail') });
    }

    return items;
  }

  return [{ title: t('shell.header.breadcrumb.home') }];
}

function safeReadBoolean(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function safeWriteBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Persisting shell UI preferences is best effort.
  }
}
