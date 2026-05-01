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
  it('uploads dropped files with progress and success feedback', async () => {
    const requests = stubXmlHttpRequest();
    const onUploaded = vi.fn<(response: UploadResponse, file: File) => void>();
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' });

    render(<FileUploadZone spaceId="space-1" accessToken="test-token" onUploaded={onUploaded} />);

    const dropzone = getDropzone();
    fireEvent.drop(dropzone, createDropEvent(file));

    expect(await screen.findByText(/source_document_id: source-1/i)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ source_document_id: 'source-1' }), file);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('/api/spaces/space-1/uploads');
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('supports click selection through the hidden file input', async () => {
    stubXmlHttpRequest('source-click');
    const onUploaded = vi.fn<(response: UploadResponse, file: File) => void>();
    const file = new File(['hello'], 'report.pdf', { type: 'application/pdf' });

    render(<FileUploadZone spaceId="space-1" accessToken={null} onUploaded={onUploaded} />);

    const input = screen.getByLabelText('Choose files for upload');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/source_document_id: source-click/i)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ source_document_id: 'source-click' }), file);
  });

  it('rejects unsupported file types before sending a request', async () => {
    const requests = stubXmlHttpRequest();
    const file = new File(['bad'], 'script.exe', { type: 'application/octet-stream' });

    render(<FileUploadZone spaceId="space-1" accessToken={null} onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Choose files for upload'), { target: { files: [file] } });

    expect(await screen.findByText('UNSUPPORTED_FILE_TYPE')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported file type/i)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('rejects files larger than 200 MB before sending a request', async () => {
    const requests = stubXmlHttpRequest();
    const file = new File(['large'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 201 * 1024 * 1024 });

    render(<FileUploadZone spaceId="space-1" accessToken={null} onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Choose files for upload'), { target: { files: [file] } });

    expect(await screen.findByText('FILE_TOO_LARGE')).toBeInTheDocument();
    expect(screen.getByText(/200 MB upload limit/i)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});

describe('UrlUploadForm', () => {
  it('validates URLs before submitting', async () => {
    const fetchMock = stubUrlUploadApi();

    render(<UrlUploadForm spaceId="space-1" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'ftp://example.com/file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add URL' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid http or https URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits valid URL uploads', async () => {
    const fetchMock = stubUrlUploadApi();
    const onUploaded = vi.fn<(response: UploadResponse, url: string) => void>();

    render(<UrlUploadForm spaceId="space-1" onUploaded={onUploaded} />);

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/doc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add URL' }));

    expect(await screen.findByRole('status')).toHaveTextContent('source-url');
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ source_document_id: 'source-url' }), 'https://example.com/doc');
    expect(getRequestPath(fetchMock.mock.calls[0]?.[0] ?? '')).toBe('/api/spaces/space-1/uploads');
    expect(JSON.parse(getRequestBody(fetchMock.mock.calls[0]?.[1]))).toEqual({
      source_type: 'url',
      url: 'https://example.com/doc',
    });
  });
});

describe('UploadList', () => {
  it('renders status badges, rows, and actions', () => {
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

    expect(getStatusBadge('Parsing')).toHaveClass('status-info');
    expect(getStatusBadge('Parsed')).toHaveClass('status-healthy');
    expect(getStatusBadge('Parse Failed')).toHaveClass('status-unhealthy');
    expect(screen.getByRole('columnheader', { name: 'Filename' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Details' })).toHaveLength(3);
  });

  it('renders pagination controls', () => {
    const onPageChange = vi.fn<(page: number) => void>();

    render(
      <UploadList
        uploads={[buildUpload({ id: 'source-page' })]}
        page={2}
        total={41}
        statusFilter=""
        onStatusFilterChange={vi.fn()}
        onPageChange={onPageChange}
        onSelectUpload={vi.fn()}
      />,
    );

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
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
  it('shows detail metadata, progress, failure details, and reprocess action', async () => {
    const fetchMock = stubReprocessApi();
    const onReprocessed = vi.fn<(response: UploadResponse) => void>();

    render(
      <UploadDetail
        upload={buildUpload({ status: 'parse_failed' })}
        status={buildStatus({ status: 'parse_failed', progress_percent: 65 })}
        onClose={vi.fn()}
        onReprocessed={onReprocessed}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Upload detail' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Parse failed progress' })).toHaveAttribute('aria-valuenow', '65');
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

function createDropEvent(file: File) {
  return {
    dataTransfer: {
      files: [file],
      items: [
        {
          kind: 'file',
          type: file.type,
          getAsFile: () => file,
        },
      ],
      types: ['Files'],
    },
  };
}

function getDropzone(): Element {
  const dropzone = screen.getByText('Drop files or click to select').closest('.upload-dropzone');
  if (dropzone === null) {
    throw new Error('Dropzone not found');
  }

  return dropzone;
}

function getStatusBadge(label: string): HTMLElement {
  const badge = screen.getAllByText(label).find((element) => element.classList.contains('status-badge'));
  if (badge === undefined) {
    throw new Error(`Status badge not found: ${label}`);
  }

  return badge;
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
