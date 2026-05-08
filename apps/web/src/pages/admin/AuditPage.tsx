import { ReloadOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { formatDate, getErrorMessage } from '../../components/adminUi';
import { type AuditLog } from '../../lib/adminTypes';

function AuditPage() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [space, setSpace] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await api.get<AuditLog[]>('/admin/audit-logs', {
        action,
        actor,
        space,
        from,
        to,
        per_page: 100,
        sort: '-created_at',
      });
      setLogs(data);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [action, actor, from, space, to]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  function handleDateRangeChange(dates: [Dayjs | null, Dayjs | null] | null): void {
    if (dates === null || dates[0] === null || dates[1] === null) {
      setFrom('');
      setTo('');
      return;
    }
    setFrom(dates[0].toISOString());
    setTo(dates[1].toISOString());
  }

  const columns: ColumnsType<AuditLog> = [
    {
      title: t('admin.audit.columns.timestamp'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => formatDate(val),
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: t('admin.audit.columns.actor'),
      dataIndex: 'actor_user_id',
      key: 'actor_user_id',
      render: (val: string | null) => val ?? t('common.state.system'),
    },
    {
      title: t('admin.audit.columns.action'),
      dataIndex: 'action',
      key: 'action',
      render: (val: string) => <Typography.Text code>{val}</Typography.Text>,
    },
    {
      title: t('admin.audit.columns.resource'),
      key: 'resource',
      render: (_: unknown, log: AuditLog) => (
        <span>
          {log.resource_type}
          {log.resource_id !== null ? (
            <Typography.Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }}>{log.resource_id}</Typography.Text>
          ) : null}
        </span>
      ),
    },
    {
      title: t('admin.audit.columns.space'),
      dataIndex: 'space_id',
      key: 'space_id',
      render: (val: string | null) => val ?? <Tag>{t('common.state.global')}</Tag>,
    },
    {
      title: t('admin.audit.columns.request'),
      dataIndex: 'request_id',
      key: 'request_id',
      render: (val: string | null) => val ?? <Typography.Text type="secondary">{t('common.state.notRecorded')}</Typography.Text>,
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.audit.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.audit.description')}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void loadLogs(); }}>
          {t('common.action.refresh')}
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder={t('admin.audit.filter.actionPlaceholder')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          allowClear
          style={{ width: 200 }}
        />
        <Input
          placeholder={t('admin.audit.filter.actorPlaceholder')}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          allowClear
          style={{ width: 200 }}
        />
        <Input
          placeholder={t('admin.audit.filter.spacePlaceholder')}
          value={space}
          onChange={(e) => setSpace(e.target.value)}
          allowClear
          style={{ width: 200 }}
        />
        <DatePicker.RangePicker
          showTime
          onChange={(dates) => handleDateRangeChange(dates as [Dayjs | null, Dayjs | null] | null)}
          placeholder={[t('admin.audit.filter.dateRange'), t('admin.audit.filter.dateRange')]}
        />
      </Space>

      <Table<AuditLog>
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `${total}` }}
        locale={{ emptyText: t('admin.audit.emptyFilter') }}
        size="middle"
      />
    </>
  );
}

export default requireAdminPage(AuditPage);
