// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileUploadZone from '../pages/uploads/FileUploadZone';
import UploadDetail from '../pages/uploads/UploadDetail';
import UploadList from '../pages/uploads/UploadList';
import UrlUploadForm from '../pages/uploads/UrlUploadForm';
import type { UploadItem, UploadResponse, UploadStatus } from '../pages/uploads/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    render(
      <UploadList
        uploads={[
          buildUpload({ id: 'source-1', filename: 'notes.md', status: 'parsing' }),
          buildUpload({ id: 'source-2', filename: 'done.pdf', status: 'parsed' }),
          buildUpload({ id: 'source-3', filename: 'bad.pdf', status: 'parse_failed' }),
        ]}
        page={1}
        total={3}
        statusFilter=""
        onStatusFilterChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelectUpload={vi.fn()}
      />,
    );

    // antd Tag renders status labels
    expect(screen.getByText('Parsing')).toBeInTheDocument();
    expect(screen.getByText('Parsed')).toBeInTheDocument();
    expect(screen.getByText('Parse Failed')).toBeInTheDocument();
    // antd Table column headers
    expect(screen.getByText('Filename')).toBeInTheDocument();
    // Details buttons
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(3);
  });

  it('renders an empty state', () => {
    render(
      <UploadList
        uploads={[]}
        page={1}
        total={0}
        statusFilter=""
        onStatusFilterChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelectUpload={vi.fn()}
      />,
    );

    expect(screen.getByText('No uploads match the current filters.')).toBeInTheDocument();
  });
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

  it('hides reprocess for completed uploads', () => {
    render(
      <UploadDetail
        open
        upload={buildUpload({ status: 'parsed' })}
        status={buildStatus({ status: 'parsed', progress_percent: 100 })}
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

function getRequestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected request body to be a JSON string');
  }

  return init.body;
}
