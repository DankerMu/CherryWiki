import { Button, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { formatDate, formatLabel } from '../../components/adminUi';
import {
  UPLOAD_PAGE_SIZE,
  UPLOAD_STATUS_OPTIONS,
  formatFileSize,
  getUploadStatusClass,
  type UploadItem,
} from './types';

type UploadListProps = {
  uploads: UploadItem[];
  page: number;
  total: number;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onPageChange: (page: number) => void;
  onSelectUpload: (upload: UploadItem) => void;
};

function uploadStatusColor(status: string): string {
  const cls = getUploadStatusClass(status);
  if (cls === 'healthy') return 'green';
  if (cls === 'unhealthy') return 'red';
  return 'blue';
}

export default function UploadList({
  uploads,
  page,
  total,
  statusFilter,
  onStatusFilterChange,
  onPageChange,
  onSelectUpload,
}: UploadListProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<UploadItem> = [
    {
      title: t('upload.list.columns.filename'),
      key: 'filename',
      render: (_: unknown, upload: UploadItem) => (
        <div>
          <Typography.Text strong>{upload.filename}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{upload.id}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('upload.list.columns.type'),
      dataIndex: 'source_type',
      key: 'source_type',
      render: (val: string) => formatLabel(val),
    },
    {
      title: t('upload.list.columns.size'),
      dataIndex: 'size_bytes',
      key: 'size_bytes',
      render: (val: number | null) => formatFileSize(val),
    },
    {
      title: t('upload.list.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <Tag color={uploadStatusColor(val)}>{formatLabel(val)}</Tag>,
    },
    {
      title: t('upload.list.columns.uploader'),
      dataIndex: 'uploader_id',
      key: 'uploader_id',
      render: (val: string | null) => val ?? t('upload.list.unknown'),
    },
    {
      title: t('upload.list.columns.time'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => formatDate(val),
    },
    {
      title: t('upload.list.columns.actions'),
      key: 'actions',
      render: (_: unknown, upload: UploadItem) => (
        <Button
          size="small"
          onClick={(e) => { e.stopPropagation(); onSelectUpload(upload); }}
        >
          {t('upload.list.details')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>{t('upload.list.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('upload.list.description')}</Typography.Text>
        </div>
        <Space>
          <Select
            value={statusFilter || undefined}
            onChange={(val) => onStatusFilterChange(val ?? '')}
            placeholder={t('upload.list.filter.allStatuses')}
            allowClear
            style={{ width: 160 }}
          >
            {UPLOAD_STATUS_OPTIONS.map((status) => (
              <Select.Option key={status} value={status}>{formatLabel(status)}</Select.Option>
            ))}
          </Select>
        </Space>
      </div>

      <Table<UploadItem>
        columns={columns}
        dataSource={uploads}
        rowKey="id"
        onRow={(upload) => ({
          onClick: () => onSelectUpload(upload),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: UPLOAD_PAGE_SIZE,
          total,
          onChange: onPageChange,
          showTotal: (totalItems, range) => t('upload.list.pagination.showing', { from: range[0], to: range[1], total: totalItems }),
        }}
        locale={{ emptyText: t('upload.list.emptyFilter') }}
        size="middle"
      />
    </>
  );
}

export function UploadStatusBadge({ status }: { status: string }) {
  return <Tag color={uploadStatusColor(status)}>{formatLabel(status)}</Tag>;
}
