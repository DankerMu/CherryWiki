import {
  BookOutlined,
  CloudUploadOutlined,
  MessageOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import { SpaceForbiddenState, useSpacePermissionGate } from '../../components/SpacePermissionGate';
import { getGraphCommunities } from '../../lib/graphApi';
import { getGraphifyRun, listGraphifyRuns, type GraphifyRun } from '../../lib/graphifyApi';
import { useAuth } from '../../lib/auth';
import {
  getRecentDocuments,
  getRecentWikiPages,
  getSpace,
  getSpaceStats,
  type RecentDocument,
  type RecentWikiPage,
  type SpaceDetail,
  type SpaceStats,
} from '../../lib/spaceApi';
import NotFound from '../NotFound';

type OverviewErrors = {
  space: string | null;
  stats: string | null;
  documents: string | null;
  wikiPages: string | null;
  communities: string | null;
  graphifyRun: string | null;
};

const EMPTY_ERRORS: OverviewErrors = {
  space: null,
  stats: null,
  documents: null,
  wikiPages: null,
  communities: null,
  graphifyRun: null,
};

export default function SpaceOverviewPage() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const { hasSpacePermission } = useAuth();
  const gate = useSpacePermissionGate('space:view');
  const [space, setSpace] = useState<SpaceDetail | null>(null);
  const [stats, setStats] = useState<SpaceStats | null>(null);
  const [documents, setDocuments] = useState<RecentDocument[]>([]);
  const [wikiPages, setWikiPages] = useState<RecentWikiPage[]>([]);
  const [communityCount, setCommunityCount] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<GraphifyRun | null>(null);
  const [errors, setErrors] = useState<OverviewErrors>(EMPTY_ERRORS);
  const [isLoading, setIsLoading] = useState(true);
  const requestSeqRef = useRef(0);

  const loadOverview = useCallback(async () => {
    if (spaceId.length === 0) {
      setIsLoading(false);
      return;
    }

    if (!gate.isAllowed) {
      requestSeqRef.current++;
      setIsLoading(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setErrors(EMPTY_ERRORS);
    setSpace(null);
    setStats(null);
    setDocuments([]);
    setWikiPages([]);
    setCommunityCount(0);
    setActiveRun(null);

    const setError = (key: keyof OverviewErrors, error: unknown): void => {
      if (seq !== requestSeqRef.current) return;
      setErrors((current) => ({ ...current, [key]: getErrorMessage(error) }));
    };

    await Promise.allSettled([
      getSpace(spaceId)
        .then(async (nextSpace) => {
          if (seq !== requestSeqRef.current) return;
          setSpace(nextSpace);
          if (nextSpace.active_graphify_run_id === null) {
            try {
              const latestRuns = await listGraphifyRuns({
                space_id: spaceId,
                per_page: 1,
                sort: '-created_at',
              });
              if (seq !== requestSeqRef.current) return;
              const latestRun = latestRuns.data[0];
              if (latestRun !== undefined) {
                setActiveRun(latestRun);
              }
            } catch (err) {
              setError('graphifyRun', err);
            }
            return;
          }
          try {
            const response = await getGraphifyRun(nextSpace.active_graphify_run_id);
            if (seq !== requestSeqRef.current) return;
            setActiveRun(response.data);
          } catch (err) {
            setError('graphifyRun', err);
          }
        })
        .catch((err) => {
          if (seq !== requestSeqRef.current) return;
          setSpace(null);
          setError('space', err);
        }),
      getSpaceStats(spaceId)
        .then((nextStats) => {
          if (seq !== requestSeqRef.current) return;
          setStats(nextStats);
        })
        .catch((err) => {
          if (seq !== requestSeqRef.current) return;
          setStats(null);
          setError('stats', err);
        }),
      getRecentDocuments(spaceId)
        .then((response) => {
          if (seq !== requestSeqRef.current) return;
          setDocuments(response.data);
        })
        .catch((err) => {
          if (seq !== requestSeqRef.current) return;
          setDocuments([]);
          setError('documents', err);
        }),
      getRecentWikiPages(spaceId)
        .then((response) => {
          if (seq !== requestSeqRef.current) return;
          setWikiPages(response.data);
        })
        .catch((err) => {
          if (seq !== requestSeqRef.current) return;
          setWikiPages([]);
          setError('wikiPages', err);
        }),
      getGraphCommunities(spaceId)
        .then((response) => {
          if (seq !== requestSeqRef.current) return;
          setCommunityCount(response.communities.length);
        })
        .catch((err) => {
          if (seq !== requestSeqRef.current) return;
          setCommunityCount(null);
          setError('communities', err);
        }),
    ]);

    if (seq === requestSeqRef.current) {
      setIsLoading(false);
    }
  }, [gate.isAllowed, spaceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  if (!gate.isAllowed) {
    return <SpaceForbiddenState />;
  }

  return (
    <Spin spinning={isLoading && space === null && stats === null}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t('overview.title')}
            </Typography.Title>
            <Typography.Text type="secondary">{space?.name ?? t('overview.description')}</Typography.Text>
          </div>
          <Button
            aria-label={t('common.action.refresh')}
            icon={<ReloadOutlined />}
            onClick={() => { void loadOverview(); }}
            loading={isLoading}
          >
            {t('common.action.refresh')}
          </Button>
        </div>

        {errors.space !== null ? <Alert type="warning" showIcon message={errors.space} /> : null}

        <SpaceStatsStrip stats={stats} error={errors.stats} />

        <KnowledgeStatusPanel
          spaceId={spaceId}
          space={space}
          stats={stats}
          communityCount={communityCount}
          activeRun={activeRun}
          errors={errors}
          canRunGraphify={hasSpacePermission(spaceId, 'graphify:run')}
        />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <RecentDocumentsList
              spaceId={spaceId}
              documents={documents}
              error={errors.documents}
              canCreateUploads={hasSpacePermission(spaceId, 'upload:create')}
            />
          </Col>
          <Col xs={24} lg={12}>
            <RecentWikiPagesList
              spaceId={spaceId}
              pages={wikiPages}
              error={errors.wikiPages}
              canRunGraphify={hasSpacePermission(spaceId, 'graphify:run')}
            />
          </Col>
        </Row>

        <KnowledgeQuickActions spaceId={spaceId} />
      </Space>
    </Spin>
  );
}

function SpaceStatsStrip({ stats, error }: { stats: SpaceStats | null; error: string | null }) {
  const { t } = useTranslation();

  if (error !== null) {
    return (
      <Card>
        <Alert type="error" showIcon message={t('overview.error.stats')} description={error} />
      </Card>
    );
  }

  const cards = [
    { key: 'documents', title: t('overview.stats.documents'), value: stats?.source_count ?? 0 },
    { key: 'wikiPages', title: t('overview.stats.wikiPages'), value: stats?.page_count ?? 0 },
    { key: 'graphNodes', title: t('overview.stats.graphNodes'), value: stats?.node_count ?? 0 },
    { key: 'graphEdges', title: t('overview.stats.graphEdges'), value: stats?.edge_count ?? 0 },
  ];

  return (
    <Row gutter={[16, 16]}>
      {cards.map((card) => (
        <Col key={card.key} xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title={card.title} value={card.value} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function KnowledgeStatusPanel({
  spaceId,
  space,
  stats,
  communityCount,
  activeRun,
  errors,
  canRunGraphify,
}: {
  spaceId: string;
  space: SpaceDetail | null;
  stats: SpaceStats | null;
  communityCount: number | null;
  activeRun: GraphifyRun | null;
  errors: OverviewErrors;
  canRunGraphify: boolean;
}) {
  const { t } = useTranslation();
  const indexConsistency = space?.index_consistency_status ?? stats?.index_consistency ?? 'unavailable';
  const indexHealthy = isHealthyIndex(indexConsistency);
  const graphAvailable = (stats?.node_count ?? 0) > 0;
  const activeRunIsProcessing = activeRun?.status === 'pending' || activeRun?.status === 'running';

  return (
    <Card title={t('overview.status.title')}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {!indexHealthy ? (
          <Alert
            type="warning"
            showIcon
            message={t('overview.status.indexWarning', { status: formatLabel(indexConsistency) })}
            description={(
              <Space size={12} wrap>
                <Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki`}>
                  {t('overview.status.reviewWiki')}
                </Link>
                {canRunGraphify ? (
                  <Link to={`/spaces/${encodeURIComponent(spaceId)}/graphify`}>
                    {t('overview.status.runGraphify')}
                  </Link>
                ) : null}
              </Space>
            )}
          />
        ) : null}
        {errors.communities !== null ? <Alert type="warning" showIcon message={errors.communities} /> : null}
        {errors.graphifyRun !== null ? <Alert type="warning" showIcon message={errors.graphifyRun} /> : null}
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label={t('overview.status.indexConsistency')}>
            <Tag color={indexHealthy ? 'success' : 'warning'}>{formatLabel(indexConsistency)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('overview.status.strictMode')}>
            <Tag color={space?.strict_knowledge_only ? 'blue' : 'default'}>
              {space?.strict_knowledge_only ? t('overview.status.enabled') : t('overview.status.disabled')}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('overview.status.graphAvailability')}>
            {graphAvailable ? (
              <Link to={`/spaces/${encodeURIComponent(spaceId)}/graph`}>{t('overview.status.graphAvailable')}</Link>
            ) : (
              <Typography.Text type="secondary">{t('overview.status.graphUnavailable')}</Typography.Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('overview.status.communities')}>
            {communityCount ?? t('common.state.unavailable')}
          </Descriptions.Item>
          <Descriptions.Item label={t('overview.status.activeRun')} span={2}>
            {activeRun === null ? (
              <Typography.Text type="secondary">{t('overview.status.noActiveRun')}</Typography.Text>
            ) : (
              <Space wrap>
                <Tag color={activeRunIsProcessing ? 'processing' : statusColor(activeRun.status)}>
                  {formatLabel(activeRun.status)}
                </Tag>
                {activeRun.progress !== null ? (
                  <Progress percent={activeRun.progress.percent} size="small" style={{ width: 120 }} />
                ) : null}
                <Link to={`/spaces/${encodeURIComponent(spaceId)}/graphify/${encodeURIComponent(activeRun.run_id)}`}>
                  {t('overview.status.viewRun')}
                </Link>
              </Space>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
}

function RecentDocumentsList({
  spaceId,
  documents,
  error,
  canCreateUploads,
}: {
  spaceId: string;
  documents: RecentDocument[];
  error: string | null;
  canCreateUploads: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card
      title={t('overview.recentDocuments.title')}
      extra={<Link to={`/spaces/${encodeURIComponent(spaceId)}/uploads`}>{t('overview.action.viewAll')}</Link>}
    >
      {error !== null ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      <List
        dataSource={documents}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('overview.recentDocuments.empty')}
            >
              {canCreateUploads ? (
                <Link to={`/spaces/${encodeURIComponent(spaceId)}/uploads`}>
                  <Button type="primary">{t('overview.action.addDocuments')}</Button>
                </Link>
              ) : null}
            </Empty>
          ),
        }}
        renderItem={(document) => (
          <List.Item>
            <List.Item.Meta
              title={<Link to={`/spaces/${encodeURIComponent(spaceId)}/uploads`}>{document.filename}</Link>}
              description={(
                <Space size={8} wrap>
                  <Tag>{formatLabel(document.source_type)}</Tag>
                  <StatusTag status={document.status} />
                  <Typography.Text type="secondary">{formatDate(document.updated_at)}</Typography.Text>
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

function RecentWikiPagesList({
  spaceId,
  pages,
  error,
  canRunGraphify,
}: {
  spaceId: string;
  pages: RecentWikiPage[];
  error: string | null;
  canRunGraphify: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Card
      title={t('overview.recentWikiPages.title')}
      extra={<Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki`}>{t('overview.action.viewAll')}</Link>}
    >
      {error !== null ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      <List
        dataSource={pages}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('overview.recentWikiPages.empty')}
            >
              {canRunGraphify ? (
                <Link to={`/spaces/${encodeURIComponent(spaceId)}/graphify`}>
                  <Button>{t('overview.action.runGraphify')}</Button>
                </Link>
              ) : null}
            </Empty>
          ),
        }}
        renderItem={(page) => (
          <List.Item>
            <List.Item.Meta
              title={(
                <Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(page.page_id)}`}>
                  {page.title}
                </Link>
              )}
              description={(
                <Space size={8} wrap>
                  <StatusTag status={page.status} />
                  <Typography.Text type="secondary">{formatDate(page.updated_at)}</Typography.Text>
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

function KnowledgeQuickActions({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const { hasSpacePermission } = useAuth();
  const actions: Array<{ key: string; label: string; to: string; icon: ReactNode; permissions: string[] }> = [
    {
      key: 'documents',
      label: t('overview.quickActions.documents'),
      to: `/spaces/${encodeURIComponent(spaceId)}/uploads`,
      icon: <CloudUploadOutlined />,
      permissions: ['upload:read'],
    },
    {
      key: 'wiki',
      label: t('overview.quickActions.wiki'),
      to: `/spaces/${encodeURIComponent(spaceId)}/wiki`,
      icon: <BookOutlined />,
      permissions: ['space:view'],
    },
    {
      key: 'graph',
      label: t('overview.quickActions.graph'),
      to: `/spaces/${encodeURIComponent(spaceId)}/graph`,
      icon: <ShareAltOutlined />,
      permissions: ['space:view'],
    },
    {
      key: 'graphify',
      label: t('overview.quickActions.graphify'),
      to: `/spaces/${encodeURIComponent(spaceId)}/graphify`,
      icon: <NodeIndexOutlined />,
      permissions: ['graphify:run'],
    },
    {
      key: 'chat',
      label: t('overview.quickActions.chat'),
      to: `/spaces/${encodeURIComponent(spaceId)}/chat`,
      icon: <MessageOutlined />,
      permissions: ['space:view', 'chat:use'],
    },
  ].filter((action) => action.permissions.every((permission) => hasSpacePermission(spaceId, permission)));

  return (
    <Card title={t('overview.quickActions.title')}>
      <Space wrap>
        {actions.map((action) => (
          <Link key={action.key} to={action.to}>
            <Button aria-label={action.label} icon={action.icon}>{action.label}</Button>
          </Link>
        ))}
      </Space>
    </Card>
  );
}

function StatusTag({ status }: { status: string }) {
  return <Tag color={statusColor(status)}>{formatLabel(status)}</Tag>;
}

function statusColor(status: string): string {
  if (status === 'healthy' || status === 'consistent' || status === 'parsed' || status === 'published' || status === 'succeeded') {
    return 'success';
  }

  if (status === 'pending' || status === 'running' || status === 'uploaded' || status === 'parsing') {
    return 'processing';
  }

  if (status === 'failed' || status === 'parse_failed' || status === 'security_rejected') {
    return 'error';
  }

  if (status === 'stale' || status === 'degraded') {
    return 'warning';
  }

  return 'default';
}

function isHealthyIndex(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'healthy' || normalized === 'consistent';
}
