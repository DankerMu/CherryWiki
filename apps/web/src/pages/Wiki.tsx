import { useLocation, useParams, useSearchParams } from 'react-router';
import NotFound from './NotFound.js';
import WikiPageDetail from './wiki/WikiPageDetail.js';
import WikiPageList from './wiki/WikiPageList.js';
import WikiVersionHistory from './wiki/WikiVersionHistory.js';

export default function Wiki() {
  const { spaceId, pageId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  if (spaceId === undefined || spaceId.length === 0) {
    return <NotFound />;
  }

  if (pageId === undefined || pageId.length === 0) {
    return <WikiPageList spaceId={spaceId} />;
  }

  const encodedPageId = encodeURIComponent(pageId);
  const isHistoryView =
    searchParams.get('view') === 'history' || location.pathname.endsWith(`/wiki/${encodedPageId}/history`);

  if (isHistoryView) {
    return <WikiVersionHistory spaceId={spaceId} pageId={pageId} />;
  }

  const versionId = searchParams.get('version_id');

  return (
    <WikiPageDetail
      spaceId={spaceId}
      pageId={pageId}
      {...(versionId !== null && versionId.length > 0 ? { versionId } : {})}
    />
  );
}
