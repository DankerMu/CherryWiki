export const AUDIT_EVENTS = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_TOKEN_REFRESH: 'auth.token_refresh',
  AUTH_FAILED_LOGIN: 'auth.failed_login',
  AUTH_PASSWORD_CHANGE: 'auth.password_change',
  AUTH_SESSION_REVOKE: 'auth.session_revoke',
  ADMIN_USER_CREATE: 'admin.user.create',
  ADMIN_USER_UPDATE: 'admin.user.update',
  ADMIN_USER_DISABLE: 'admin.user.disable',
  ADMIN_USER_DELETE: 'admin.user.delete',
  ADMIN_GROUP_CREATE: 'admin.group.create',
  USER_GROUP_CHANGE: 'user.group_change',
  SPACE_CREATE: 'space.create',
  SPACE_UPDATE: 'space.update',
  SPACE_PERMISSION_CHANGE: 'space.permission_change',
  ADMIN_MODEL_CREATE: 'admin.model.create',
  ADMIN_MODEL_UPDATE: 'admin.model.update',
  ADMIN_MODEL_TEST: 'admin.model.test',
  CHAT_COMPLETION: 'chat.completion',
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
