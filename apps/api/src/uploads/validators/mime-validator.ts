import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { extname } from 'node:path';

import { type SecurityValidationResult, validationPass, validationReject } from './validation-result.js';

export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.zip',
] as const;

export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

export type MimeValidationInput = {
  filename: string;
  declaredMimeType: string;
  buffer: Buffer;
};

export type UploadMagicBytesValidationInput = {
  filename: string;
  buffer: Buffer;
  declaredMimeType?: string;
};

type FileTypeDetection = {
  ext: string;
  mime: string;
};

export const MIME_HEADER_BYTES = 4096;
const PLAIN_TEXT_EXTENSIONS = new Set<AllowedUploadExtension>(['.md', '.mdx', '.txt', '.rst']);
const EXTENSION_MIME_MAP = {
  '.md': ['text/markdown', 'text/plain'],
  '.mdx': ['text/markdown', 'text/mdx', 'text/plain'],
  '.txt': ['text/plain'],
  '.rst': ['text/x-rst', 'text/plain'],
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
} as const satisfies Record<AllowedUploadExtension, readonly string[]>;

@Injectable()
export class MimeValidator {
  async validate(input: MimeValidationInput): Promise<SecurityValidationResult> {
    return validateUploadMagicBytes({
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      buffer: input.buffer,
    });
  }
}

export function getUploadExtension(filename: string): AllowedUploadExtension | undefined {
  const extension = extname(filename).toLowerCase();
  return isAllowedUploadExtension(extension) ? extension : undefined;
}

export function isAllowedUploadExtension(extension: string): extension is AllowedUploadExtension {
  return ALLOWED_UPLOAD_EXTENSIONS.includes(extension as AllowedUploadExtension);
}

export function isZipUpload(filename: string, mimeDetails?: Record<string, unknown>): boolean {
  const extension = getUploadExtension(filename);
  if (extension === '.zip') {
    return true;
  }

  return mimeDetails?.detected_mime === 'application/zip' || mimeDetails?.declared_mime === 'application/zip';
}

export async function validateUploadMagicBytes(
  input: UploadMagicBytesValidationInput,
): Promise<SecurityValidationResult> {
  const extension = getUploadExtension(input.filename);
  const declaredMime = input.declaredMimeType === undefined ? undefined : normalizeMime(input.declaredMimeType);
  if (extension === undefined) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'File extension is missing or unsupported', {
      filename: input.filename,
      ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
    });
  }

  if (
    declaredMime !== undefined &&
    declaredMime !== 'application/octet-stream' &&
    !isMimeAllowedForExtension(declaredMime, extension)
  ) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Declared Content-Type does not match file extension', {
      filename: input.filename,
      extension,
      declared_mime: declaredMime,
      expected_mime: EXTENSION_MIME_MAP[extension],
    });
  }

  if (PLAIN_TEXT_EXTENSIONS.has(extension)) {
    return validatePlainText(input, extension, declaredMime);
  }

  const detected = await detectFileType(input.buffer.subarray(0, MIME_HEADER_BYTES));
  if (detected === undefined) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Unable to detect file type from magic bytes', {
      filename: input.filename,
      extension,
      ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
    });
  }

  const detectedMime = normalizeMime(detected.mime);
  if (!isMimeAllowedForExtension(detectedMime, extension)) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Detected MIME type does not match file extension', {
      filename: input.filename,
      extension,
      ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
      detected_mime: detectedMime,
      detected_extension: detected.ext,
      expected_mime: EXTENSION_MIME_MAP[extension],
    });
  }

  if (declaredMime !== undefined && declaredMime !== 'application/octet-stream' && !areCompatibleMimes(declaredMime, detectedMime, extension)) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Declared Content-Type does not match detected MIME type', {
      filename: input.filename,
      extension,
      declared_mime: declaredMime,
      detected_mime: detectedMime,
    });
  }

  return validationPass({
    filename: input.filename,
    extension,
    ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
    detected_mime: detectedMime,
  });
}

function validatePlainText(
  input: UploadMagicBytesValidationInput,
  extension: AllowedUploadExtension,
  declaredMime: string | undefined,
): SecurityValidationResult {
  if (input.buffer.length >= 2 && input.buffer[0] === 0x23 && input.buffer[1] === 0x21) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Plain text upload appears to be an executable script', {
      filename: input.filename,
      extension,
      ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
      signal: 'shebang',
    });
  }

  if (input.buffer.includes(0x00)) {
    return validationReject(ErrorCode.MIME_MISMATCH, 'Plain text upload contains null bytes', {
      filename: input.filename,
      extension,
      ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
      signal: 'null_byte',
    });
  }

  return validationPass({
    filename: input.filename,
    extension,
    ...(declaredMime !== undefined ? { declared_mime: declaredMime } : {}),
    detected_mime: 'text/plain',
  });
}

async function detectFileType(buffer: Buffer): Promise<FileTypeDetection | undefined> {
  const { fileTypeFromBuffer } = await import('file-type');
  return fileTypeFromBuffer(buffer);
}

function isMimeAllowedForExtension(mime: string, extension: AllowedUploadExtension): boolean {
  return (EXTENSION_MIME_MAP[extension] as readonly string[]).includes(mime);
}

function areCompatibleMimes(declaredMime: string, detectedMime: string, extension: AllowedUploadExtension): boolean {
  return isMimeAllowedForExtension(declaredMime, extension) && isMimeAllowedForExtension(detectedMime, extension);
}

function normalizeMime(value: string): string {
  const [type] = value.toLowerCase().split(';', 1);
  return type?.trim() ?? '';
}
