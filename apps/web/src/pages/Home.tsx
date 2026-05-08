import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

export default function Home() {
  const { t } = useTranslation();
  const { isAdmin, user } = useAuth();

  const firstSpace = user?.spaces?.[0];

  if (firstSpace !== undefined) {
    return <Navigate to={`/spaces/${encodeURIComponent(firstSpace.id)}/chat`} replace />;
  }

  if (isAdmin) {
    return <Navigate to="/admin/spaces" replace />;
  }

  return (
    <div style={{ textAlign: 'center', padding: 48 }}>
      <h1>{t('home.noSpaces.description')}</h1>
    </div>
  );
}
