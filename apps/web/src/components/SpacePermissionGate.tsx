import { Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useAuth } from '../lib/auth';
import NotFound from '../pages/NotFound';

export type SpacePermissionGateState = {
  spaceId: string;
  isAllowed: boolean;
  requiredPermissions: string[];
};

export function useSpacePermissionGate(
  requiredPermissions: string | string[],
  spaceIdOverride?: string,
): SpacePermissionGateState {
  const { spaceId: routeSpaceId = '' } = useParams();
  const { hasSpacePermission } = useAuth();
  const spaceId = spaceIdOverride ?? routeSpaceId;
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  const isAllowed =
    spaceId.length > 0 && permissions.every((permission) => hasSpacePermission(spaceId, permission));

  return {
    spaceId,
    isAllowed,
    requiredPermissions: permissions,
  };
}

export function SpaceForbiddenState({ context }: { context?: 'chat' | 'graphify' | 'upload' }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (context === 'chat') {
    return (
      <Result
        status="403"
        title={t('chat.forbidden.title')}
        subTitle={t('chat.forbidden.description', { email: user?.email ?? '' })}
      />
    );
  }

  if (context === 'graphify') {
    return (
      <Result
        status="403"
        title={t('graphify.space.forbidden.title')}
        subTitle={t('graphify.space.forbidden.description', { email: user?.email ?? '' })}
      />
    );
  }

  if (context === 'upload') {
    return (
      <Result
        status="403"
        title={t('upload.forbidden.title')}
        subTitle={t('upload.forbidden.description', { email: user?.email ?? '' })}
      />
    );
  }

  return (
    <Result
      status="403"
      title={t('space.forbidden.title')}
      subTitle={t('space.forbidden.description', { email: user?.email ?? '' })}
    />
  );
}

function renderSpaceForbiddenState(context: 'chat' | 'graphify' | 'upload' | undefined): React.ReactNode {
  return context === undefined ? <SpaceForbiddenState /> : <SpaceForbiddenState context={context} />;
}

export function GuardedSpaceRoute({
  children,
  context,
  permissions,
}: {
  children: React.ReactNode;
  context?: 'chat' | 'graphify' | 'upload';
  permissions: string | string[];
}) {
  const gate = useSpacePermissionGate(permissions);

  if (gate.spaceId.length === 0) {
    return <NotFound />;
  }

  if (!gate.isAllowed) {
    return <>{renderSpaceForbiddenState(context)}</>;
  }

  return <>{children}</>;
}
