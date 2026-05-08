import { Button, Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

export default function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title={t('notFound.title')}
      subTitle={t('notFound.subtitle')}
      extra={
        <Button type="primary" onClick={() => { void navigate('/'); }}>
          {t('notFound.backHome')}
        </Button>
      }
    />
  );
}
