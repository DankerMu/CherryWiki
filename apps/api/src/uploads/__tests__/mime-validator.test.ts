import { ErrorCode } from '@cherrygraph/shared';
import { fileTypeFromBuffer } from 'file-type';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MimeValidator, isZipUpload, validateUploadMagicBytes } from '../validators/mime-validator.js';

vi.mock('file-type', async (importOriginal) => {
  const actual = await importOriginal<typeof import('file-type')>();
  return {
    ...actual,
    fileTypeFromBuffer: vi.fn(actual.fileTypeFromBuffer),
  };
});

const fileTypeFromBufferMock = vi.mocked(fileTypeFromBuffer);

describe('MimeValidator', () => {
  afterEach(() => {
    fileTypeFromBufferMock.mockClear();
  });

  it('passes when magic bytes, declared MIME, and extension match', async () => {
    const result = await new MimeValidator().validate({
      filename: 'report.pdf',
      declaredMimeType: 'application/pdf',
      buffer: validPdfBuffer(),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.pdf',
        detected_mime: 'application/pdf',
      },
    });
  });

  it('rejects an ELF binary disguised as a PDF', async () => {
    const result = await new MimeValidator().validate({
      filename: 'report.pdf',
      declaredMimeType: 'application/pdf',
      buffer: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128)]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
    });
  });

  it('rejects a shell script disguised as plain text', async () => {
    const result = await new MimeValidator().validate({
      filename: 'notes.txt',
      declaredMimeType: 'text/plain',
      buffer: Buffer.from('#!/bin/sh\necho owned\n'),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
      details: {
        signal: 'shebang',
      },
    });
  });

  it('rejects uploads without an allowed extension', async () => {
    const result = await new MimeValidator().validate({
      filename: 'report',
      declaredMimeType: 'application/pdf',
      buffer: validPdfBuffer(),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
    });
  });

  it('rejects binary content pretending to be text', async () => {
    const result = await new MimeValidator().validate({
      filename: 'notes.txt',
      declaredMimeType: 'text/plain',
      buffer: Buffer.from([0x48, 0x00, 0x49]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
      details: {
        signal: 'null_byte',
      },
    });
  });

  it('passes .md with application/octet-stream declared MIME', async () => {
    const result = await new MimeValidator().validate({
      filename: 'readme.md',
      declaredMimeType: 'application/octet-stream',
      buffer: Buffer.from('# Hello\nThis is a markdown file.\n'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.md',
      },
    });
  });

  it('passes .txt with application/octet-stream declared MIME', async () => {
    const result = await new MimeValidator().validate({
      filename: 'notes.txt',
      declaredMimeType: 'application/octet-stream',
      buffer: Buffer.from('Plain text content for notes.\n'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.txt',
      },
    });
  });

  it('still rejects dangerous files even with application/octet-stream', async () => {
    const result = await new MimeValidator().validate({
      filename: 'notes.txt',
      declaredMimeType: 'application/octet-stream',
      buffer: Buffer.from('#!/bin/sh\necho owned\n'),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
      details: {
        signal: 'shebang',
      },
    });
  });

  it('allows plain markdown without magic bytes', async () => {
    const result = await new MimeValidator().validate({
      filename: 'readme.md',
      declaredMimeType: 'text/markdown; charset=utf-8',
      buffer: Buffer.from('# Notes\nPlain project documentation.\n'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.md',
        detected_mime: 'text/plain',
      },
    });
  });

  it('passes XLSX files detected as ZIP containers', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'zip', mime: 'application/zip' });

    const result = await validateUploadMagicBytes({
      filename: 'workbook.xlsx',
      buffer: Buffer.from('zip container'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.xlsx',
        detected_mime: 'application/zip',
      },
    });
  });

  it('passes DOCX files detected as ZIP containers', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'zip', mime: 'application/zip' });

    const result = await validateUploadMagicBytes({
      filename: 'document.docx',
      buffer: Buffer.from('zip container'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.docx',
        detected_mime: 'application/zip',
      },
    });
  });

  it('passes PPTX files detected as ZIP containers', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'zip', mime: 'application/zip' });

    const result = await validateUploadMagicBytes({
      filename: 'slides.pptx',
      buffer: Buffer.from('zip container'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.pptx',
        detected_mime: 'application/zip',
      },
    });
  });

  it('passes ZIP files detected as ZIP containers', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'zip', mime: 'application/zip' });

    const result = await validateUploadMagicBytes({
      filename: 'archive.zip',
      buffer: Buffer.from('zip container'),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.zip',
        detected_mime: 'application/zip',
      },
    });
  });

  it('rejects XLSX files detected as executables', async () => {
    fileTypeFromBufferMock.mockResolvedValueOnce({ ext: 'elf', mime: 'application/x-executable' });

    const result = await validateUploadMagicBytes({
      filename: 'workbook.xlsx',
      buffer: Buffer.from('executable content'),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
      details: {
        extension: '.xlsx',
        detected_mime: 'application/x-executable',
      },
    });
  });
});

describe('isZipUpload', () => {
  it.each(['.xlsx', '.docx', '.pptx'] as const)('does not treat OOXML %s files detected as ZIP as archive uploads', (extension) => {
    expect(isZipUpload(`file${extension}`, { detected_mime: 'application/zip' })).toBe(false);
  });

  it('still treats .zip files detected as ZIP as archive uploads', () => {
    expect(isZipUpload('archive.zip', { detected_mime: 'application/zip' })).toBe(true);
  });
});

function validPdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
}
