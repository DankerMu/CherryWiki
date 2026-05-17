import { Alert, Modal, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../../components/adminUi';
import { ApiError } from '../../lib/api';
import { wikiApi, type WikiDiff } from '../../lib/wikiApi';

type WikiVersionDiffProps = {
  open: boolean;
  spaceId: string;
  pageId: string;
  fromVersionId: string | null;
  toVersionId: string | null;
  onClose: () => void;
};

type DiffState = {
  oldContent: string;
  newContent: string;
  diff: WikiDiff;
};

export default function WikiVersionDiff({
  open,
  spaceId,
  pageId,
  fromVersionId,
  toVersionId,
  onClose,
}: WikiVersionDiffProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [state, setState] = useState<DiffState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || fromVersionId === null || toVersionId === null) {
      setState(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      wikiApi.getContent(spaceId, pageId, fromVersionId),
      wikiApi.getContent(spaceId, pageId, toVersionId),
      wikiApi.getDiff(spaceId, pageId, fromVersionId, toVersionId),
    ])
      .then(([oldResponse, newResponse, diffResponse]) => {
        if (cancelled) return;
        setState({
          oldContent: oldResponse.data.content_markdown,
          newContent: newResponse.data.content_markdown,
          diff: diffResponse.data,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setError(err.message);
          return;
        }
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fromVersionId, open, pageId, spaceId, toVersionId]);

  return (
    <Modal
      title={t('wiki.diff.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1200px, 96vw)"
      destroyOnClose
    >
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <Spin />
        </div>
      )}

      {!isLoading && error !== null && <Alert type="error" message={error} showIcon />}

      {!isLoading && error === null && state !== null && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap>
            <Typography.Text type="secondary">
              {t('wiki.diff.versionPair', {
                from: state.diff.from_version_id,
                to: state.diff.to_version_id,
              })}
            </Typography.Text>
            <Typography.Text type="success">
              {t('wiki.diff.additions', { count: state.diff.stats.additions })}
            </Typography.Text>
            <Typography.Text type="danger">
              {t('wiki.diff.deletions', { count: state.diff.stats.deletions })}
            </Typography.Text>
          </Space>
          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <ReactDiffViewer
              oldValue={state.oldContent}
              newValue={state.newContent}
              splitView
              compareMethod={DiffMethod.LINES}
              leftTitle={t('wiki.diff.fromTitle', { id: state.diff.from_version_id })}
              rightTitle={t('wiki.diff.toTitle', { id: state.diff.to_version_id })}
            />
          </div>
        </Space>
      )}
    </Modal>
  );
}
