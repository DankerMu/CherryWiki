import { Button, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDate, formatLabel } from '../../components/adminUi';
import {
  DEFAULT_UPLOAD_SORT,
  UPLOAD_PAGE_SIZE,
  UPLOAD_SORT_OPTIONS,
  UPLOAD_SOURCE_TYPE_OPTIONS,
  UPLOAD_STATUS_OPTIONS,
  formatFileSize,
  getUploadStatusClass,
  normalizeUploadSort,
  normalizeUploadSourceTypeFilter,
  normalizeUploadStatusFilter,
  type UploadItem,
} from './types';

type UploadListProps = {
  uploads: UploadItem[];
  page: number;
  total: number;
  statusFilter: string;
  sourceTypeFilter: string;
  searchTerm: string;
  sortOrder: string;
  onStatusFilterChange: (status: string) => void;
  onSourceTypeFilterChange: (sourceType: string) => void;
  onSearchTermChange: (search: string) => void;
  onSortOrderChange: (sort: string) => void;
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
  sourceTypeFilter,
  searchTerm,
  sortOrder,
  onStatusFilterChange,
  onSourceTypeFilterChange,
  onSearchTermChange,
  onSortOrderChange,
  onPageChange,
  onSelectUpload,
}: UploadListProps) {
  const { t } = useTranslation();
  const selectedStatusFilter = normalizeUploadStatusFilter(statusFilter);
  const selectedSourceTypeFilter = normalizeUploadSourceTypeFilter(sourceTypeFilter);
  const selectedSort = normalizeUploadSort(sortOrder);
  const hasActiveFilters =
    selectedStatusFilter.length > 0 ||
    selectedSourceTypeFilter.length > 0 ||
    searchTerm.trim().length > 0;

  const columns: ColumnsType<UploadItem> = [
    {
      title: t('upload.list.columns.filename'),
      key: 'filename',
      render: (_: unknown, upload: UploadItem) => (
        <div>
          <Typography.Text strong>{upload.filename}</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Space size={4} wrap>
              <Tag style={{ marginInlineEnd: 0 }}>{formatSourceTypeLabel(t, upload.source_type)}</Tag>
              {upload.mime_type !== null && upload.mime_type.length > 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{upload.mime_type}</Typography.Text>
              ) : null}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: t('upload.list.columns.type'),
      dataIndex: 'source_type',
      key: 'source_type',
      render: (val: string) => <Tag>{formatSourceTypeLabel(t, val)}</Tag>,
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
      render: (val: string) => <Tag color={uploadStatusColor(val)}>{formatUploadStatusLabel(t, val)}</Tag>,
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
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          aria-label={t('upload.list.search.placeholder')}
          enterButton={t('common.action.search')}
          maxLength={200}
          onChange={(event) => onSearchTermChange(event.target.value)}
          onSearch={(value) => onSearchTermChange(value)}
          placeholder={t('upload.list.search.placeholder')}
          style={{ width: 280 }}
          value={searchTerm}
        />
        <Select
          aria-label={t('upload.list.filter.status')}
          value={selectedStatusFilter || undefined}
          onChange={(val) => onStatusFilterChange(val ?? '')}
          placeholder={t('upload.list.filter.allStatuses')}
          allowClear
          style={{ width: 160 }}
        >
          {UPLOAD_STATUS_OPTIONS.map((status) => (
            <Select.Option key={status} value={status}>{formatUploadStatusLabel(t, status)}</Select.Option>
          ))}
        </Select>
        <Space size={6}>
          <Typography.Text type="secondary">{t('upload.list.filter.sourceType')}</Typography.Text>
          <Select
            aria-label={t('upload.list.filter.sourceType')}
            value={selectedSourceTypeFilter || undefined}
            onChange={(val) => onSourceTypeFilterChange(val ?? '')}
            placeholder={t('upload.list.filter.allTypes')}
            allowClear
            style={{ width: 160 }}
          >
            {UPLOAD_SOURCE_TYPE_OPTIONS.map((sourceType) => (
              <Select.Option key={sourceType} value={sourceType}>{formatSourceTypeLabel(t, sourceType)}</Select.Option>
            ))}
          </Select>
        </Space>
        <Space size={6}>
          <Typography.Text type="secondary">{t('upload.list.sort.label')}</Typography.Text>
          <Select
            aria-label={t('upload.list.sort.label')}
            value={selectedSort}
            onChange={(val) => onSortOrderChange(val ?? DEFAULT_UPLOAD_SORT)}
            style={{ width: 180 }}
          >
            {UPLOAD_SORT_OPTIONS.map((sortOption) => (
              <Select.Option key={sortOption} value={sortOption}>{t(getSortTranslationKey(sortOption))}</Select.Option>
            ))}
          </Select>
        </Space>
      </Space>

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
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={hasActiveFilters ? t('upload.list.emptyFilter') : t('upload.list.emptySpace')}
            />
          ),
        }}
        size="middle"
      />
    </>
  );
}

export function UploadStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return <Tag color={uploadStatusColor(status)}>{formatUploadStatusLabel(t, status)}</Tag>;
}

function formatSourceTypeLabel(t: TFunction, value: string): string {
  const key = `upload.list.sourceTypes.${value}`;
  const label = t(key);
  if (label !== key) {
    return label;
  }

  return value.toLowerCase() === 'url' ? 'URL' : formatLabel(value);
}

function formatUploadStatusLabel(t: TFunction, value: string): string {
  const key = `upload.list.statusOptions.${value}`;
  const label = t(key);
  return label === key ? formatLabel(value) : label;
}

function getSortTranslationKey(sortOption: string): string {
  switch (sortOption) {
    case '-updated_at':
      return 'upload.list.sort.updatedAt';
    case 'filename':
      return 'upload.list.sort.filename';
    case 'status':
      return 'upload.list.sort.status';
    case '-created_at':
    default:
      return 'upload.list.sort.createdAt';
  }
}
