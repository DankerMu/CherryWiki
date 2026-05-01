import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

import { getUploadExtension } from './mime-validator.js';
import { type SecurityValidationResult, validationPass, validationReject } from './validation-result.js';

export type ZipValidationInput = {
  filename: string;
  buffer: Buffer;
};

const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ENTRY_COMPRESSION_RATIO = 100;
const MAX_NESTING_DEPTH = 3;
const MAX_ENTRY_COUNT = 10_000;

@Injectable()
export class ZipValidator {
  async validate(input: ZipValidationInput): Promise<SecurityValidationResult> {
    return this.validateBuffer(input.buffer, 0, input.filename);
  }

  private async validateBuffer(buffer: Buffer, depth: number, filename: string): Promise<SecurityValidationResult> {
    if (depth > MAX_NESTING_DEPTH) {
      return validationReject(ErrorCode.ZIP_NESTING_EXCEEDED, 'ZIP nesting depth exceeded', {
        filename,
        depth,
        max_depth: MAX_NESTING_DEPTH,
      });
    }

    const tempPath = join(tmpdir(), `cherrywiki-upload-${randomUUID()}.zip`);
    await writeFile(tempPath, buffer);

    try {
      return await this.validatePath(tempPath, depth, filename);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async validatePath(path: string, depth: number, filename: string): Promise<SecurityValidationResult> {
    return new Promise((resolve) => {
      yauzl.open(path, { lazyEntries: true, validateEntrySizes: false }, (openErr, zipfile) => {
        if ((openErr !== null && openErr !== undefined) || zipfile === undefined) {
          resolve(
            validationReject(ErrorCode.MIME_MISMATCH, 'Invalid ZIP archive', {
              filename,
              depth,
              error: openErr instanceof Error ? openErr.message : String(openErr),
            }),
          );
          return;
        }

        let entryCount = 0;
        let totalUncompressedBytes = 0;
        let settled = false;

        const finish = (result: SecurityValidationResult): void => {
          if (settled) {
            return;
          }

          settled = true;
          zipfile.close();
          resolve(result);
        };

        if (zipfile.entryCount > MAX_ENTRY_COUNT) {
          finish(
            validationReject(ErrorCode.ZIP_BOMB_DETECTED, 'ZIP entry count exceeded', {
              filename,
              depth,
              entry_count: zipfile.entryCount,
              max_entry_count: MAX_ENTRY_COUNT,
            }),
          );
          return;
        }

        zipfile.on('entry', (entry: Entry) => {
          entryCount += 1;
          totalUncompressedBytes += entry.uncompressedSize;
          if (entryCount > MAX_ENTRY_COUNT) {
            finish(
              validationReject(ErrorCode.ZIP_BOMB_DETECTED, 'ZIP entry count exceeded', {
                filename,
                depth,
                entry_count: entryCount,
                max_entry_count: MAX_ENTRY_COUNT,
              }),
            );
            return;
          }
          if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            finish(
              validationReject(ErrorCode.ZIP_BOMB_DETECTED, 'ZIP total uncompressed size exceeded', {
                filename,
                depth,
                total_uncompressed_bytes: totalUncompressedBytes,
                max_total_uncompressed_bytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
              }),
            );
            return;
          }

          void this.processEntry(zipfile, entry, depth)
            .then((entryResult) => {
              if (settled) {
                return;
              }
              if (!entryResult.pass) {
                finish(entryResult);
                return;
              }

              zipfile.readEntry();
            })
            .catch((err: unknown) => {
              finish(
                validationReject(ErrorCode.MIME_MISMATCH, 'ZIP entry could not be read', {
                  filename,
                  depth,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            });
        });

        zipfile.on('end', () => {
          finish(validationPass({ filename, depth, entry_count: entryCount, total_uncompressed_bytes: totalUncompressedBytes }));
        });

        zipfile.on('error', (err: Error) => {
          if (isZipPathValidationError(err)) {
            finish(
              validationReject(ErrorCode.PATH_TRAVERSAL_DETECTED, 'ZIP entry path traversal detected', {
                filename,
                depth,
                error: err.message,
              }),
            );
            return;
          }

          finish(
            validationReject(ErrorCode.MIME_MISMATCH, 'ZIP archive could not be read', {
              filename,
              depth,
              error: err.message,
            }),
          );
        });

        zipfile.readEntry();
      });
    });
  }

  private async processEntry(zipfile: ZipFile, entry: Entry, depth: number): Promise<SecurityValidationResult> {
    const unsafePathResult = validateEntryPath(entry.fileName);
    if (!unsafePathResult.pass) {
      return unsafePathResult;
    }

    if (isZipSymlink(entry)) {
      return validationReject(ErrorCode.ZIP_SYMLINK_DETECTED, 'ZIP entry is a symlink', {
        entry: entry.fileName,
      });
    }

    const bombResult = validateEntrySize(entry);
    if (!bombResult.pass) {
      return bombResult;
    }

    if (isDirectoryEntry(entry)) {
      return validationPass();
    }

    const extension = getUploadExtension(entry.fileName);
    if (extension === undefined) {
      return validationReject(ErrorCode.MIME_MISMATCH, 'ZIP entry file type is not allowed', {
        entry: entry.fileName,
      });
    }

    if (extension !== '.zip') {
      return validationPass();
    }

    const nestedBuffer = await readEntryBuffer(zipfile, entry);
    return this.validateBuffer(nestedBuffer, depth + 1, entry.fileName);
  }
}

function validateEntryPath(fileName: string): SecurityValidationResult {
  if (fileName.startsWith('/') || fileName.startsWith('\\') || fileName.includes('../') || fileName.includes('..\\')) {
    return validationReject(ErrorCode.PATH_TRAVERSAL_DETECTED, 'ZIP entry path traversal detected', {
      entry: fileName,
    });
  }

  return validationPass();
}

function isZipPathValidationError(err: Error): boolean {
  return err.message.includes('invalid relative path') || err.message.includes('absolute path');
}

function validateEntrySize(entry: Entry): SecurityValidationResult {
  if (entry.compressedSize === 0 && entry.uncompressedSize > 0) {
    return validationReject(ErrorCode.ZIP_BOMB_DETECTED, 'ZIP entry has zero compressed size with nonzero output', {
      entry: entry.fileName,
      compressed_size: entry.compressedSize,
      uncompressed_size: entry.uncompressedSize,
    });
  }

  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_ENTRY_COMPRESSION_RATIO) {
    return validationReject(ErrorCode.ZIP_BOMB_DETECTED, 'ZIP entry compression ratio exceeded', {
      entry: entry.fileName,
      compressed_size: entry.compressedSize,
      uncompressed_size: entry.uncompressedSize,
      max_ratio: MAX_ENTRY_COMPRESSION_RATIO,
    });
  }

  return validationPass();
}

function isZipSymlink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0o177777;
  return (unixMode & 0o170000) === 0o120000;
}

function isDirectoryEntry(entry: Entry): boolean {
  return entry.fileName.endsWith('/');
}

function readEntryBuffer(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if ((err !== null && err !== undefined) || stream === undefined) {
        reject(err ?? new Error(`Failed to read ZIP entry ${entry.fileName}`));
        return;
      }

      resolve(readStream(stream));
    });
  });
}

function readStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
}
