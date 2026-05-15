// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth';
import FileUploadZone from '../pages/uploads/FileUploadZone';
import UploadCenter from '../pages/uploads/UploadCenter';
import UploadDetail from '../pages/uploads/UploadDetail';
import UploadList from '../pages/uploads/UploadList';
import UrlUploadForm from '../pages/uploads/UrlUploadForm';
import type { UploadItem, UploadResponse, UploadStatus } from '../pages/uploads/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('FileUploadZone', () => {
  it('uploads files with progress and success feedback via XHR', async () => {
    const requests = stubXmlHttpRequest();
    const onUploaded = vi.fn<(response: UploadResponse, file: File) => void>();
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });

    render(<FileUploadZone spaceId="space-1" accessToken="test-token" onUploaded={onUploaded} />);

    // antd Upload.Dragger uses a regular file input
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Simulate file selection through the input
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/source_document_id: source-1/i)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ source_document_id: 'source-1' }), file);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('/api/spaces/space-1/uploads');
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('rejects unsupported file types before sending a request', async () => {
    const requests = stubXmlHttpRequest();
    const file = new File(['bad'], 'script.exe', { type: 'application/octet-stream' });

    render(<FileUploadZone spaceId="space-1" accessToken={null} onUploaded={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('UNSUPPORTED_FILE_TYPE')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('rejects files larger than 200 MB before sending a request', async () => {
    const requests = stubXmlHttpRequest();
    const file = new File(['large'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 201 * 1024 * 1024 });

    render(<FileUploadZone spaceId="space-1" accessToken={null} onUploaded={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('FILE_TOO_LARGE')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});

describe('UrlUploadForm', () => {
  it('validates URLs before submitting', async () => {
    const fetchMock = stubUrlUploadApi();

    render(<UrlUploadForm spaceId="space-1" onUploaded={vi.fn()} />);

    const input = screen.getByPlaceholderText('https://example.com/article');
    fireEvent.change(input, { target: { value: 'ftp://example.com/file' } });
    fireEvent.click(screen.getByRole('button', { name: /Add URL/i }));

    await waitFor(() => {
      expect(screen.getByText(/Enter a valid http or https URL/i)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits valid URL uploads', async () => {
    const fetchMock = stubUrlUploadApi();
    const onUploaded = vi.fn<(response: UploadResponse, url: string) => void>();

    render(<UrlUploadForm spaceId="space-1" onUploaded={onUploaded} />);

    const input = screen.getByPlaceholderText('https://example.com/article');
    fireEvent.change(input, { target: { value: 'https://example.com/doc' } });
    fireEvent.click(screen.getByRole('button', { name: /Add URL/i }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(
        expect.objectContaining({ source_document_id: 'source-url' }),
        'https://example.com/doc',
      );
    });
    expect(getRequestPath(fetchMock.mock.calls[0]?.[0] ?? '')).toBe('/api/spaces/space-1/uploads');
    expect(JSON.parse(getRequestBody(fetchMock.mock.calls[0]?.[1]))).toEqual({
      source_type: 'url',
      url: 'https://example.com/doc',
    });
  });
});

describe('UploadList', () => {
  it('renders status tags, rows, and details buttons', () => {
    renderUploadList({
      uploads: [
        buildUpload({ id: 'source-1', filename: 'notes.md', status: 'parsing' }),
        buildUpload({ id: 'source-2', filename: 'done.pdf', status: 'parsed' }),
        buildUpload({ id: 'source-3', filename: 'bad.pdf', status: 'parse_failed' }),
      ],
      total: 3,
    });

    // antd Tag renders status labels
    expect(screen.getByText('Parsing')).toBeInTheDocument();
    expect(screen.getByText('Parsed')).toBeInTheDocument();
    expect(screen.getByText('Parse Failed')).toBeInTheDocument();
    // antd Table column headers
    expect(screen.getByText('Filename')).toBeInTheDocument();
    // Details buttons
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(3);
  });

  it('renders filename metadata without raw source document IDs in the primary row', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';

    renderUploadList({
      uploads: [
        buildUpload({
          id: uuid,
          filename: 'security-review.pdf',
          mime_type: 'application/pdf',
          source_type: 'upload',
          status: 'parsed',
        }),
      ],
      total: 1,
    });

    expect(screen.getByText('security-review.pdf')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });

  it('renders document search, source type filter, and sort controls', () => {
    renderUploadList();

    expect(screen.getByPlaceholderText('Search filenames')).toBeInTheDocument();
    expect(screen.getByText('Source type')).toBeInTheDocument();
    expect(screen.getByText('All types')).toBeInTheDocument();
    expect(screen.getByText('Sort by')).toBeInTheDocument();
    expect(screen.getByText('Newest created')).toBeInTheDocument();
  });

  it('updates filename searches from the search control', () => {
    const onSearchTermChange = vi.fn<(search: string) => void>();

    renderUploadList({
      onSearchTermChange,
    });

    fireEvent.change(screen.getByPlaceholderText('Search filenames'), { target: { value: 'roadmap' } });

    expect(onSearchTermChange).toHaveBeenCalledWith('roadmap');
  });

  it('updates source type and sort selections', async () => {
    const onSourceTypeFilterChange = vi.fn<(sourceType: string) => void>();
    const onSortOrderChange = vi.fn<(sort: string) => void>();

    renderUploadList({
      onSourceTypeFilterChange,
      onSortOrderChange,
    });

    fireEvent.mouseDown(getComboboxByLabel('Source type'));
    fireEvent.click(await findSelectOption('URL'));
    expect(onSourceTypeFilterChange).toHaveBeenCalledWith('url');

    fireEvent.mouseDown(getComboboxByLabel('Sort by'));
    fireEvent.click(await findSelectOption('Recently updated'));
    expect(onSortOrderChange).toHaveBeenCalledWith('-updated_at');
  });

  it('renders an empty document-space state', () => {
    renderUploadList();

    expect(screen.getByText('No documents in this space yet.')).toBeInTheDocument();
  });

  it('renders an empty filtered state', () => {
    renderUploadList({ searchTerm: 'roadmap' });

    expect(screen.getByText('No documents match the current filters.')).toBeInTheDocument();
  });
});

describe('UploadCenter', () => {
  it('renders upload items when the API returns paginated data', async () => {
    const upload = buildUpload({
      id: 'source-visible',
      filename: 'visible-document.md',
      status: 'parsed',
      mime_type: 'text/markdown',
    });
    stubUploadListApiResponse({
      data: [upload],
      meta: {
        pagination: {
          page: 1,
          per_page: 20,
          total: 1,
          has_next: false,
        },
      },
    });

    renderUploadCenter();

    expect(await screen.findByText('visible-document.md')).toBeInTheDocument();
    expect(screen.queryByText('No documents in this space yet.')).not.toBeInTheDocument();
  });

  it('renders upload items when paginated data is nested in the wrapped response', async () => {
    const upload = buildUpload({
      id: 'source-nested',
      filename: 'nested-document.pdf',
      status: 'parsed',
      mime_type: 'application/pdf',
    });
    stubUploadListApiResponse({
      data: {
        data: [upload],
        pagination: {
          page: 1,
          per_page: 20,
          total: 1,
          has_next: false,
        },
      },
      meta: {
        request_id: 'req-nested',
      },
    });

    renderUploadCenter();

    expect(await screen.findByText('nested-document.pdf')).toBeInTheDocument();
    expect(screen.queryByText('No documents in this space yet.')).not.toBeInTheDocument();
  });

  it('shows the empty state when the upload API returns no data', async () => {
    stubUploadListApiResponse({
      data: [],
      meta: {
        pagination: {
          page: 1,
          per_page: 20,
          total: 0,
          has_next: false,
        },
      },
    });

    renderUploadCenter();

    expect(await screen.findByText('No documents in this space yet.')).toBeInTheDocument();
  });

  it('shows an error message when the upload API fails', async () => {
    stubUploadListApiResponse(
      {
        error: {
          code: 'UPLOAD_LIST_FAILED',
          message: 'Could not load uploads',
        },
      },
      500,
    );

    renderUploadCenter();

    expect(await screen.findByText('Could not load uploads')).toBeInTheDocument();
  });

  it('loads documents with search, source type, and sort query parameters', { timeout: 30000 }, async () => {
    const fetchMock = stubUploadListApi();

    renderUploadCenter();

    expect(await screen.findByText('Documents')).toBeInTheDocument();
    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces/space-1/uploads?page=1&per_page=20&sort=-created_at');
    });

    const searchInput = await screen.findByPlaceholderText('Search filenames');
    fireEvent.change(searchInput, { target: { value: 'roadmap' } });
    await waitFor(() => expect(searchInput).toHaveValue('roadmap'));

    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces/space-1/uploads?page=1&per_page=20&search=roadmap&sort=-created_at');
    });

    await waitFor(() => getComboboxByLabel('Source type'));
    fireEvent.mouseDown(getComboboxByLabel('Source type'));
    fireEvent.click(await findSelectOption('URL'));
    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces/space-1/uploads?page=1&per_page=20&source_type=url&search=roadmap&sort=-created_at');
    });

    await waitFor(() => getComboboxByLabel('Sort by'));
    fireEvent.mouseDown(getComboboxByLabel('Sort by'));
    fireEvent.click(await findSelectOption('Recently updated'));
    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces/space-1/uploads?page=1&per_page=20&source_type=url&search=roadmap&sort=-updated_at');
    });
  });

  it('lets viewers read the upload list without rendering upload forms', async () => {
    const fetchMock = stubUploadListApi();

    renderUploadCenter(VIEWER_USER);

    expect(await screen.findByText('roadmap.pdf')).toBeInTheDocument();
    expect(screen.getByText('Space Documents')).toBeInTheDocument();
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add URL/i })).not.toBeInTheDocument();
    expect(getRequestUrls(fetchMock)).toContain('/api/spaces/space-1/uploads?page=1&per_page=20&sort=-created_at');
  });

  it('hides reprocess for read-only viewers on failed uploads', async () => {
    const fetchMock = stubUploadListApi(
      buildUpload({
        id: 'source-failed',
        filename: 'failed.pdf',
        status: 'parse_failed',
        mime_type: 'application/pdf',
      }),
    );

    renderUploadCenter(VIEWER_USER);

    expect(await screen.findByText('failed.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    await waitFor(() => expect(screen.getAllByText('failed.pdf').length).toBeGreaterThan(1));
    expect(screen.queryByRole('button', { name: 'Reprocess' })).not.toBeInTheDocument();
    expect(getRequestUrls(fetchMock)).not.toContain('/api/uploads/source-failed/reprocess');
  }, 30_000);

  it('shows no permission and skips upload API requests when upload read is denied', async () => {
    const fetchMock = stubUploadListApi();

    renderUploadCenter(NO_UPLOAD_PERMISSION_USER);

    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('blocked@example.com does not have upload access for this space.')).toBeInTheDocument();
    expect(screen.queryByText('Space Documents')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores stale upload drawer status responses after selection changes', async () => {
    const statusRequests = stubUploadDrawerRaceApi();

    renderUploadCenter();

    expect(await screen.findByText('doc-a.md')).toBeInTheDocument();
    const detailsButtons = screen.getAllByRole('button', { name: 'Details' });

    fireEvent.click(detailsButtons[0]!);
    await waitFor(() => expect(screen.getAllByText('doc-a.md').length).toBeGreaterThan(1));

    fireEvent.click(detailsButtons[1]!);
    await waitFor(() => expect(screen.getAllByText('doc-b.md').length).toBeGreaterThan(1));

    statusRequests.get('doc-b')?.resolve(jsonResponse({ data: buildStatus({ source_document_id: 'doc-b', status: 'parsed', progress_percent: 100 }) }));
    await waitFor(() => expect(screen.getAllByText('Parsed').length).toBeGreaterThan(0));

    statusRequests
      .get('doc-a')
      ?.resolve(
        jsonResponse({
          data: buildStatus({
            source_document_id: 'doc-a',
            status: 'parse_failed',
            progress_percent: 65,
            error_json: {
              error_type: 'stale_doc_a',
              error_message: 'A stale failure should not render',
            },
          }),
        }),
      );

    await waitFor(() => expect(screen.getAllByText('doc-b.md').length).toBeGreaterThan(1));
    expect(screen.queryByText('A stale failure should not render')).not.toBeInTheDocument();
    expect(screen.queryByText('stale_doc_a')).not.toBeInTheDocument();
  }, 30_000);
});

describe('UploadDetail', () => {
  it('shows detail metadata and reprocess action for failed uploads', async () => {
    const fetchMock = stubReprocessApi();
    const onReprocessed = vi.fn<(response: UploadResponse) => void>();

    render(
      <UploadDetail
        open
        upload={buildUpload({ status: 'parse_failed' })}
        status={buildStatus({ status: 'parse_failed', progress_percent: 65 })}
        canReprocess
        onClose={vi.fn()}
        onReprocessed={onReprocessed}
      />,
    );

    // antd Drawer renders the title
    expect(screen.getByText('Upload Detail')).toBeInTheDocument();
    // Failure details shown
    expect(screen.getByText('parser_error')).toBeInTheDocument();
    expect(screen.getByText('Could not parse PDF')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reprocess' }));

    await waitFor(() => expect(onReprocessed).toHaveBeenCalledWith(expect.objectContaining({ status: 'uploaded' })));
    expect(getRequestPath(fetchMock.mock.calls[0]?.[0] ?? '')).toBe('/api/uploads/source-1/reprocess');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('hides reprocess for failed uploads when reprocess is denied', () => {
    const fetchMock = stubReprocessApi();

    render(
      <UploadDetail
        open
        upload={buildUpload({ status: 'parse_failed' })}
        status={buildStatus({ status: 'parse_failed', progress_percent: 65 })}
        canReprocess={false}
        onClose={vi.fn()}
        onReprocessed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reprocess' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides reprocess for completed uploads', () => {
    render(
      <UploadDetail
        open
        upload={buildUpload({ status: 'parsed' })}
        status={buildStatus({ status: 'parsed', progress_percent: 100 })}
        canReprocess
        onClose={vi.fn()}
        onReprocessed={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reprocess' })).not.toBeInTheDocument();
  });
});

type MockXhrRequest = {
  method: string;
  url: string;
  headers: Headers;
};

const TEST_USER: AuthUser = {
  id: 'user-1',
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'editor' }],
};

const VIEWER_USER: AuthUser = {
  ...TEST_USER,
  email: 'space-viewer@example.com',
  spaces: [{ id: 'space-1', name: 'Space One', role: 'viewer' }],
};

const NO_UPLOAD_PERMISSION_USER: AuthUser = {
  ...TEST_USER,
  email: 'blocked@example.com',
  spaces: [],
};

function renderUploadList(overrides: Partial<ComponentProps<typeof UploadList>> = {}) {
  const props: ComponentProps<typeof UploadList> = {
    uploads: [],
    page: 1,
    total: 0,
    statusFilter: '',
    sourceTypeFilter: '',
    searchTerm: '',
    sortOrder: '-created_at',
    onStatusFilterChange: vi.fn(),
    onSourceTypeFilterChange: vi.fn(),
    onSearchTermChange: vi.fn(),
    onSortOrderChange: vi.fn(),
    onPageChange: vi.fn(),
    onSelectUpload: vi.fn(),
    ...overrides,
  };

  return render(<UploadList {...props} />);
}

function renderUploadCenter(user: AuthUser = TEST_USER) {
  return render(
    <MemoryRouter initialEntries={['/spaces/space-1/uploads']}>
      <AuthProvider initialSession={{ user, accessToken: 'test-token', expiresIn: 3600 }}>
        <Routes>
          <Route path="/spaces/:spaceId/uploads" element={<UploadCenter />} />
          <Route path="/login" element={<h1>Login</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function stubXmlHttpRequest(sourceDocumentId = 'source-1'): MockXhrRequest[] {
  const requests: MockXhrRequest[] = [];

  class MockXMLHttpRequest {
    method = '';
    url = '';
    headers = new Headers();
    status = 201;
    responseText = JSON.stringify({
      data: {
        source_document_id: sourceDocumentId,
        file_blob_id: 'blob-1',
        job_id: 'job-1',
        status: 'uploaded',
        created: true,
      },
    });
    withCredentials = false;
    upload: { onprogress: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null } = {
      onprogress: null,
    };
    onload: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null = null;
    onerror: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null = null;

    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(key: string, value: string): void {
      this.headers.set(key, value);
    }

    send(): void {
      requests.push({ method: this.method, url: this.url, headers: this.headers });
      this.upload.onprogress?.(
        new ProgressEvent('progress', {
          lengthComputable: true,
          loaded: 50,
          total: 100,
        }) as ProgressEvent<XMLHttpRequestEventTarget>,
      );
      this.onload?.(new ProgressEvent('load') as ProgressEvent<XMLHttpRequestEventTarget>);
    }
  }

  vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
  return requests;
}

function stubUrlUploadApi() {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    if (getRequestPath(input) === '/api/spaces/space-1/uploads' && init?.method === 'POST') {
      return Promise.resolve(
        jsonResponse({
          data: {
            source_document_id: 'source-url',
            file_blob_id: null,
            job_id: 'job-url',
            status: 'uploaded',
            created: true,
          },
        }),
      );
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubUploadListApi(upload: UploadItem = buildUpload({
  id: 'source-roadmap',
  filename: 'roadmap.pdf',
  status: 'parsed',
  mime_type: 'application/pdf',
})) {
  return stubUploadListApiResponse({
    data: [upload],
    meta: {
      pagination: {
        page: 1,
        per_page: 20,
        total: 1,
        has_next: false,
      },
    },
  });
}

function stubUploadListApiResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    if (getRequestPath(input) === '/api/spaces/space-1/uploads' && init?.method === 'GET') {
      return Promise.resolve(jsonResponse(body, status));
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubUploadDrawerRaceApi() {
  const statusRequests = new Map<string, Deferred<Response>>();
  statusRequests.set('doc-a', createDeferred<Response>());
  statusRequests.set('doc-b', createDeferred<Response>());

  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const path = getRequestPath(input);
    if (path === '/api/spaces/space-1/uploads' && init?.method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          data: [
            buildUpload({ id: 'doc-a', filename: 'doc-a.md', status: 'uploaded' }),
            buildUpload({ id: 'doc-b', filename: 'doc-b.md', status: 'uploaded' }),
          ],
          meta: {
            pagination: {
              page: 1,
              per_page: 20,
              total: 2,
              has_next: false,
            },
          },
        }),
      );
    }

    if (path === '/api/uploads/doc-a/status' && init?.method === 'GET') {
      return statusRequests.get('doc-a')!.promise;
    }

    if (path === '/api/uploads/doc-b/status' && init?.method === 'GET') {
      return statusRequests.get('doc-b')!.promise;
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return statusRequests;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function stubReprocessApi() {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    if (getRequestPath(input) === '/api/uploads/source-1/reprocess' && init?.method === 'POST') {
      return Promise.resolve(
        jsonResponse({
          data: {
            source_document_id: 'source-1',
            file_blob_id: 'blob-1',
            job_id: 'job-reprocess',
            status: 'uploaded',
            created: true,
          },
        }),
      );
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildUpload(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'source-1',
    filename: 'notes.md',
    mime_type: 'text/markdown',
    sha256: 'a'.repeat(64),
    size_bytes: 1024,
    source_type: 'upload',
    classification: null,
    status: 'uploaded',
    uploader_id: 'user-1',
    space_id: 'space-1',
    metadata_json: { author: 'Docs' },
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:01:00.000Z',
    ...overrides,
  };
}

function buildStatus(overrides: Partial<UploadStatus> = {}): UploadStatus {
  return {
    source_document_id: 'source-1',
    status: 'uploaded',
    job_id: 'job-1',
    job_status: 'running',
    progress_percent: 50,
    error_json: {
      error_type: 'parser_error',
      error_message: 'Could not parse PDF',
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input.split('?')[0] ?? input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? input.url;
}

function getRequestUrls(fetchMock: ReturnType<typeof stubUploadListApi>): string[] {
  return fetchMock.mock.calls.map((call) => getRequestUrl(call[0]));
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  const url = input instanceof URL ? input : new URL(input.url);
  return `${url.pathname}${url.search}`;
}

function getComboboxByLabel(label: string): HTMLElement {
  const combobox = screen.getAllByLabelText(label).find((element) => element.getAttribute('role') === 'combobox');
  if (combobox === undefined) {
    throw new Error(`Combobox with label "${label}" not found`);
  }

  return combobox;
}

async function findSelectOption(label: string): Promise<HTMLElement> {
  const option = (await screen.findAllByText(label)).find((element) => element.closest('.ant-select-item-option') !== null);
  if (option === undefined) {
    throw new Error(`Select option "${label}" not found`);
  }

  return option;
}

function getRequestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected request body to be a JSON string');
  }

  return init.body;
}
