import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Popconfirm, Progress, Result, Spin, Statistic, Typography } from 'antd';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { formatDate, formatLabel, getErrorMessage } from '../components/adminUi';
import {
  cancelGraphifyRun,
  getGraphifyReport,
  getGraphifyRun,
  getGraphifySummary,
  retryGraphifyRun,
  type GraphifyReport,
  type GraphifyRun,
  type GraphifySummary,
} from '../lib/graphifyApi';
import {
  GraphifyStatusCell,
  formatCount,
  formatJson,
  formatRunDurationWithT,
  getGraphifyStat,
  getQuarantineType,
  isGraphifyRunActive,
  isQuarantined,
} from './graphifyUi';
import { useAuth } from '../lib/auth';
import NotFound from './NotFound';

const GRAPHIFY_REFRESH_INTERVAL_MS = 5_000;

export default function GraphifyRunDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaceId = '', runId = '' } = useParams();
  const { hasSpacePermission, user } = useAuth();
  const [run, setRun] = useState<GraphifyRun | null>(null);
  const [report, setReport] = useState<GraphifyReport | null>(null);
  const [summary, setSummary] = useState<GraphifySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canViewGraphify = spaceId.length > 0 && hasSpacePermission(spaceId, 'graphify:view');
  const canRunGraphify = spaceId.length > 0 && hasSpacePermission(spaceId, 'graphify:run');

  const loadRunDetail = useCallback(
    async (background = false) => {
      if (runId.length === 0 || !canViewGraphify) {
        setRun(null);
        setReport(null);
        setSummary(null);
        setIsLoading(false);
        return;
      }

      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const runResponse = await getGraphifyRun(runId);
        const currentRun = runResponse.data;
        setRun(currentRun);

        if (isGraphifyRunActive(currentRun)) {
          setReport(null);
          setSummary(null);
          return;
        }

        const [reportResult, summaryResult] = await Promise.allSettled([
          getGraphifyReport(runId),
          getGraphifySummary(runId),
        ]);
        setReport(reportResult.status === 'fulfilled' ? reportResult.value.data : null);
        setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value.data : null);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (!background) {
          setIsLoading(false);
        }
      }
    },
    [canViewGraphify, runId],
  );

  useEffect(() => {
    void loadRunDetail();
  }, [loadRunDetail]);

  useEffect(() => {
    if (run === null || !isGraphifyRunActive(run)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRunDetail(true);
    }, GRAPHIFY_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadRunDetail, run]);

  if (spaceId.length === 0 || runId.length === 0) {
    return <NotFound />;
  }

  if (!canViewGraphify) {
    return (
      <Result
        status="403"
        title={t('graphify.space.forbidden.title')}
        subTitle={t('graphify.space.forbidden.description', { email: user?.email ?? '' })}
      />
    );
  }

  async function cancelRun(): Promise<void> {
    if (run === null) return;

    setIsCancelling(true);
    setError(null);

    try {
      await cancelGraphifyRun(run.run_id);
      setRun((current) => (current === null ? current : { ...current, status: 'cancelled', completed_at: new Date().toISOString() }));
      await loadRunDetail(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }

  async function retryRun(): Promise<void> {
    if (run === null) return;

    setIsRetrying(true);
    setError(null);

    try {
      const created = await retryGraphifyRun(run.run_id);
      void navigate(`/spaces/${encodeURIComponent(created.space_id)}/graphify/${encodeURIComponent(created.run_id)}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsRetrying(false);
    }
  }

  const showCancelButton = canRunGraphify && run !== null && isGraphifyRunActive(run);
  const showRetryButton = canRunGraphify && run !== null && run.status === 'failed';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('graphify.space.detail.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('graphify.space.detail.description')}</Typography.Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => { void navigate(`/spaces/${encodeURIComponent(spaceId)}/graphify`); }}
          >
            {t('graphify.space.detail.backToGraphify')}
          </Button>
          {showCancelButton && (
            <Popconfirm
              title={t('graphify.space.detail.confirmCancel')}
              onConfirm={() => { void cancelRun(); }}
            >
              <Button danger loading={isCancelling}>
                {t('graphify.space.detail.cancelRun')}
              </Button>
            </Popconfirm>
          )}
          {showRetryButton && (
            <Popconfirm
              title={t('graphify.space.detail.confirmRetry')}
              onConfirm={() => { void retryRun(); }}
            >
              <Button loading={isRetrying}>
                {t('graphify.space.detail.retryRun')}
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      {error !== null && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Spin tip={t('graphify.space.detail.loading')}><div style={{ minHeight: 200 }} /></Spin>
      ) : run === null ? (
        <Typography.Text type="secondary">{t('graphify.space.detail.unavailable')}</Typography.Text>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>{run.run_id}</Typography.Title>
                <Typography.Text type="secondary">{run.space_id}</Typography.Text>
              </div>
              <GraphifyStatusCell run={run} />
            </div>

            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label={t('graphify.space.detail.overview.runId')}><Typography.Text copyable>{run.run_id}</Typography.Text></Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.status')}><GraphifyStatusCell run={run} /></Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.mode')}>{formatLabel(run.mode)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.trigger')}>{formatLabel(run.trigger_type)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.duration')}>{formatRunDurationWithT(run, t)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.createdAt')}>{formatDate(run.created_at)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.startedAt')}>{formatDate(run.started_at)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.completedAt')}>{formatDate(run.completed_at)}</Descriptions.Item>
              <Descriptions.Item label={t('graphify.space.detail.overview.inputScope')} span={2}>{formatInputScope(run, t)}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            title={t('graphify.space.detail.stats.title')}
            style={{ marginBottom: 16 }}
            styles={{ body: { display: 'flex', gap: 32 } }}
          >
            <Statistic
              title={t('graphify.space.detail.stats.nodes')}
              value={formatCount(summary?.summary.node_count ?? getGraphifyStat(run, 'node_count'))}
            />
            <Statistic
              title={t('graphify.space.detail.stats.edges')}
              value={formatCount(summary?.summary.edge_count ?? getGraphifyStat(run, 'edge_count'))}
            />
            <Statistic
              title={t('graphify.space.detail.stats.communities')}
              value={formatCount(summary?.summary.community_count ?? getGraphifyStat(run, 'community_count'))}
            />
            <Statistic
              title={t('graphify.space.detail.stats.wikiPages')}
              value={formatCount(getGraphifyStat(run, 'wiki_page_count'))}
            />
          </Card>

          <Card
            title="GRAPH_REPORT.md"
            style={{ marginBottom: 16 }}
            extra={
              report !== null ? (
                <Typography.Text type="secondary">
                  {t('graphify.space.detail.report.generated', { date: formatDate(report.generated_at) })}
                </Typography.Text>
              ) : null
            }
          >
            {report === null ? (
              <Typography.Text type="secondary">{t('graphify.space.detail.report.empty')}</Typography.Text>
            ) : (
              <GraphifyMarkdown content={report.content} />
            )}
          </Card>

          {run.status === 'failed' && (
            <Card title={t('graphify.space.detail.error.title')} style={{ marginBottom: 16 }}>
              <Typography.Paragraph type="secondary">
                {isQuarantined(run)
                  ? t('graphify.space.detail.error.quarantine', { type: formatLabel(getQuarantineType(run) ?? 'unknown') })
                  : t('graphify.space.detail.error.description')}
              </Typography.Paragraph>
              <pre style={{ background: 'var(--ant-color-fill-quaternary, #fafafa)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 300, fontSize: 12 }}>
                {formatJson(run.error_json)}
              </pre>
            </Card>
          )}

          {isGraphifyRunActive(run) && run.progress !== null && (
            <Card style={{ marginBottom: 16 }}>
              <Progress percent={Math.round(run.progress.percent)} />
              <Typography.Text type="secondary">{run.progress.stage}</Typography.Text>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function GraphifyMarkdown({ content }: { content: string }) {
  return <div className="markdown-body">{renderMarkdownBlocks(content)}</div>;
}

function renderMarkdownBlocks(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];

  function flushList(): void {
    if (listItems.length === 0) {
      return;
    }

    blocks.push(<ul key={`list-${blocks.length}`}>{listItems}</ul>);
    listItems = [];
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const listMatch = /^-\s+(.+)$/.exec(line);
    if (listMatch !== null) {
      listItems.push(<li key={`li-${index}`}>{renderBoldMarkdown(listMatch[1] ?? '', `li-${index}`)}</li>);
      return;
    }

    flushList();

    if (line.trim().length === 0) {
      return;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch !== null) {
      const headingMarks = headingMatch[1] ?? '';
      const headingText = headingMatch[2] ?? '';
      const children = renderBoldMarkdown(headingText, `h-${index}`);
      const level = headingMarks.length;

      if (level === 1) {
        blocks.push(<h1 key={`h-${index}`}>{children}</h1>);
      } else if (level === 2) {
        blocks.push(<h2 key={`h-${index}`}>{children}</h2>);
      } else if (level === 3) {
        blocks.push(<h3 key={`h-${index}`}>{children}</h3>);
      } else {
        blocks.push(<h4 key={`h-${index}`}>{children}</h4>);
      }
      return;
    }

    blocks.push(<p key={`p-${index}`}>{renderBoldMarkdown(line, `p-${index}`)}</p>);
  });

  flushList();
  return blocks;
}

function renderBoldMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[1] ?? ''}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function formatInputScope(run: GraphifyRun, t: (key: string) => string): string {
  const sourceDocumentNames = run.input_scope_resolved.source_documents
    .map((sourceDocument) => (sourceDocument.missing ? t('common.status.deleted') : sourceDocument.filename))
    .filter((name): name is string => name !== null && name.length > 0);
  const pageNames = run.input_scope_resolved.pages
    .map((page) => (page.missing ? t('common.status.deleted') : page.title))
    .filter((name): name is string => name !== null && name.length > 0);
  const names = [...sourceDocumentNames, ...pageNames];

  return names.length > 0 ? names.join(', ') : t('graphify.space.detail.overview.allSources');
}
