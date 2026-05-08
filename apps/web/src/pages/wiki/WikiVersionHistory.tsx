import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import { ApiError, type ApiMeta } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { wikiApi, type WikiPage, type WikiPageVersion } from '../../lib/wikiApi';
import NotFound from '../NotFound';
import { WIKI_PAGE_SIZE, WikiStatusBadge } from './wikiUi';

type WikiVersionHistoryProps = {
  spaceId: string;
  pageId: string;
};

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: WIKI_PAGE_SIZE,
  total: 0,
  has_next: false,
};

export default function WikiVersionHistory({ spaceId, pageId }: WikiVersionHistoryProps) {
  const { t } = useTranslation();
  const { hasSpacePermission } = useAuth();
  const canRollback = hasSpacePermission(spaceId, 'wiki:rollback');
  const navigate = useNavigate();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [versions, setVersions] = useState<WikiPageVersion[]>([]);
  const [pageNumber, setPageNumber] = useState(DEFAULT_PAGINATION.page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [rollingBackVersionId, setRollingBackVersionId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    setNotFound(false);

    try {
      const [pageResponse, versionsResponse] = await Promise.all([
        wikiApi.getPage(spaceId, pageId),
        wikiApi.listVersions(spaceId, pageId, { page: pageNumber, per_page: WIKI_PAGE_SIZE }),
      ]);
      setPage(pageResponse.data);
      setVersions(versionsResponse.data);
      setPagination(
        versionsResponse.meta?.pagination ?? {
          page: pageNumber,
          per_page: WIKI_PAGE_SIZE,
          total: versionsResponse.data.length,
          has_next: false,
        },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        void message.error(getErrorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, [pageId, pageNumber, spaceId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  async function rollbackVersion(version: WikiPageVersion): Promise<void> {
    setRollingBackVersionId(version.version_id);

    try {
      await wikiApi.rollback(spaceId, pageId, version.version_id);
      void navigate(`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}`);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setRollingBackVersionId(null);
    }
  }

  function openVersion(version: WikiPageVersion): void {
    void navigate(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}?version_id=${encodeURIComponent(version.version_id)}`,
    );
  }

  if (notFound) {
    return <NotFound />;
  }

  const columns: ColumnsType<WikiPageVersion> = [
    {
      title: t('wiki.history.columns.version'),
      dataIndex: 'version_id',
      key: 'version_id',
      render: (val: string) => <Typography.Text strong>{val}</Typography.Text>,
    },
    {
      title: t('wiki.history.columns.source'),
      key: 'source',
      render: (_: unknown, version: WikiPageVersion) => formatLabel(version.source_run_id ?? t('wiki.history.manual')),
    },
    {
      title: t('wiki.history.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (val: string) => <WikiStatusBadge status={val} />,
    },
    {
      title: t('wiki.history.columns.createdBy'),
      dataIndex: 'author',
      key: 'author',
    },
    {
      title: t('wiki.history.columns.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => formatDate(val),
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: t('wiki.history.columns.actions'),
      key: 'actions',
      render: (_: unknown, version: WikiPageVersion) => {
        const isCurrent = version.status === 'current';
        if (isCurrent || !canRollback) {
          return <Typography.Text type="secondary">{t('wiki.history.current')}</Typography.Text>;
        }
        return (
          <Popconfirm
            title={t('wiki.history.confirmRollback')}
            onConfirm={() => { void rollbackVersion(version); }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <Button
              size="small"
              loading={rollingBackVersionId === version.version_id}
              onClick={(e) => e.stopPropagation()}
            >
              {t('wiki.history.rollback')}
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('wiki.history.title')}</Typography.Title>
          {page !== null && <Typography.Text type="secondary">{page.title}</Typography.Text>}
        </div>
        <Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}`}>
          <Button icon={<ArrowLeftOutlined />}>{t('wiki.history.backToPage')}</Button>
        </Link>
      </div>

      <Table<WikiPageVersion>
        columns={columns}
        dataSource={versions}
        rowKey="version_id"
        loading={isLoading}
        onRow={(version) => ({
          onClick: () => openVersion(version),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: pageNumber,
          pageSize: WIKI_PAGE_SIZE,
          total: pagination.total,
          onChange: (p) => setPageNumber(p),
          showTotal: (totalItems, range) => t('wiki.history.pagination.showing', { from: range[0], to: range[1], total: totalItems }),
        }}
        locale={{ emptyText: t('wiki.history.empty') }}
        size="middle"
      />
    </>
  );
}
