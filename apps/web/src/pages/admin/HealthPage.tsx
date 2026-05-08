import { ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Space, Spin, Statistic, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { formatLabel, getErrorMessage } from '../../components/adminUi';
import { type SystemHealth } from '../../lib/adminTypes';
import { message } from 'antd';

const REFRESH_INTERVAL_MS = 30_000;

function healthStatusColor(status: string): string {
  if (status === 'healthy') return 'green';
  if (status === 'degraded') return 'orange';
  if (status === 'not_configured') return 'default';
  return 'red';
}

function HealthPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    try {
      const data = await api.get<SystemHealth>('/admin/system/health');
      setHealth(data);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    const intervalId = window.setInterval(() => {
      void loadHealth();
    }, REFRESH_INTERVAL_MS);

    return () => { window.clearInterval(intervalId); };
  }, [loadHealth]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.health.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.health.description')}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void loadHealth(); }}>
          {t('common.action.refresh')}
        </Button>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
      ) : health === null ? (
        <Empty description={t('admin.health.unavailable')} />
      ) : (
        <>
          <Space size="large" style={{ marginBottom: 24 }}>
            <Card size="small">
              <Statistic
                title={t('admin.health.overallStatus')}
                valueRender={() => <Tag color={healthStatusColor(health.status)}>{t(`common.status.${health.status}`, health.status)}</Tag>}
              />
            </Card>
            <Card size="small">
              <Statistic
                title={t('admin.health.apiUptime')}
                value={formatUptime(health.uptime)}
              />
            </Card>
            <Card size="small">
              <Statistic
                title={t('admin.health.autoRefresh')}
                value={t('admin.health.autoRefreshInterval')}
              />
            </Card>
          </Space>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {Object.entries(health.components).map(([name, component]) => (
              <Card
                key={name}
                title={
                  <Space>
                    <span>{formatLabel(name)}</span>
                    <Tag color={healthStatusColor(component.status)}>{t(`common.status.${component.status}`, component.status)}</Tag>
                  </Space>
                }
                size="small"
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <Typography.Text type="secondary">{t('admin.health.component.latency')}: </Typography.Text>
                    <Typography.Text>
                      {component.latency_ms !== undefined ? `${component.latency_ms} ms` : t('admin.health.component.latencyNA')}
                    </Typography.Text>
                  </div>
                  <div>
                    <Typography.Text type="secondary">{t('admin.health.component.details')}: </Typography.Text>
                    <Typography.Text>
                      {component.error ?? (component.status === 'not_configured' ? t('common.state.notConfigured') : t('common.state.operational'))}
                    </Typography.Text>
                  </div>
                </Space>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default requireAdminPage(HealthPage);

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}
