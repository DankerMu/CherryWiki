import { Input, Select, Space, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { formatDate, getErrorMessage } from '../../components/adminUi';
import { useSpacePermissionGate } from '../../components/SpacePermissionGate';
import { type ApiMeta } from '../../lib/api';
import { wikiApi, type WikiPage } from '../../lib/wikiApi';
import { WIKI_PAGE_SIZE, WikiStatusBadge } from './wikiUi';

type WikiPageListProps = {
  spaceId: string;
};

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: WIKI_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const STATUS_OPTIONS = ['draft', 'published', 'archived'] as const;

export default function WikiPageList({ spaceId }: WikiPageListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const gate = useSpacePermissionGate('space:view', spaceId);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);

  const loadPages = useCallback(async () => {
    if (spaceId.length === 0 || !gate.isAllowed) {
      setPages([]);
      setPagination(DEFAULT_PAGINATION);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const response = await wikiApi.listPages(spaceId, {
        page,
        per_page: WIKI_PAGE_SIZE,
        ...(statusFilter.length > 0 ? { status: statusFilter } : {}),
        ...(debouncedSearch.length > 0 ? { search: debouncedSearch } : {}),
      });
      setPages(response.data);
      setPagination(
        response.meta?.pagination ?? {
          page,
          per_page: WIKI_PAGE_SIZE,
          total: response.data.length,
          has_next: false,
        },
      );
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, gate.isAllowed, page, spaceId, statusFilter]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [spaceId]);

  function openPage(wikiPage: WikiPage): void {
    void navigate(`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(wikiPage.page_id)}`);
  }

  const columns: ColumnsType<WikiPage> = [
    {
      title: t('wiki.list.columns.title'),
      key: 'title',
      render: (_: unknown, wikiPage: WikiPage) => (
        <div>
          <Typography.Text strong>{wikiPage.title}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{wikiPage.page_id}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('wiki.list.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <WikiStatusBadge status={val} />,
    },
    {
      title: t('wiki.list.columns.updated'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      render: (val: string) => formatDate(val),
      sorter: (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    },
    {
      title: t('wiki.list.columns.createdBy'),
      dataIndex: 'created_by',
      key: 'created_by',
      render: (val: string | null) => val ?? t('wiki.list.unknown'),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('wiki.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('wiki.description')}</Typography.Text>
        </div>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder={t('wiki.list.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
          allowClear
          style={{ width: 240 }}
        />
        <Select
          value={statusFilter || undefined}
          onChange={(val) => { setStatusFilter(val ?? ''); setPage(1); }}
          placeholder={t('wiki.list.filter.allStatuses')}
          allowClear
          style={{ width: 160 }}
        >
          {STATUS_OPTIONS.map((status) => (
            <Select.Option key={status} value={status}>{t(`wiki.list.statusOptions.${status}`)}</Select.Option>
          ))}
        </Select>
      </Space>

      <Table<WikiPage>
        columns={columns}
        dataSource={pages}
        rowKey="id"
        loading={isLoading}
        onRow={(wikiPage) => ({
          onClick: () => openPage(wikiPage),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: WIKI_PAGE_SIZE,
          total: pagination.total,
          onChange: (p) => setPage(p),
          showTotal: (totalItems, range) => t('wiki.list.pagination.showing', { from: range[0], to: range[1], total: totalItems }),
        }}
        locale={{ emptyText: t('wiki.list.empty') }}
        size="middle"
      />
    </>
  );
}
