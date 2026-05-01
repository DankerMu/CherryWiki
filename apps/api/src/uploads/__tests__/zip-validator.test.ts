import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { ZipValidator } from '../validators/zip-validator.js';
import { createZipFixture } from './zip-fixture.js';

describe('ZipValidator', () => {
  it('passes a normal ZIP archive', async () => {
    const result = await new ZipValidator().validate({
      filename: 'bundle.zip',
      buffer: createZipFixture([{ name: 'notes.txt', data: Buffer.from('hello') }]),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        entry_count: 1,
      },
    });
  });

  it('rejects a ZIP bomb by compression ratio', async () => {
    const result = await new ZipValidator().validate({
      filename: 'bomb.zip',
      buffer: createZipFixture([
        {
          name: 'huge.txt',
          data: Buffer.from('x'),
          compressedSize: 1,
          uncompressedSize: 501 * 1024 * 1024,
        },
      ]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.ZIP_BOMB_DETECTED,
    });
  });

  it('rejects path traversal entries', async () => {
    const result = await new ZipValidator().validate({
      filename: 'paths.zip',
      buffer: createZipFixture([{ name: '../../evil.txt', data: Buffer.from('owned') }]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.PATH_TRAVERSAL_DETECTED,
    });
  });

  it('rejects nested ZIPs deeper than three levels', async () => {
    const level4 = createZipFixture([{ name: 'notes.txt', data: Buffer.from('deep') }]);
    const level3 = createZipFixture([{ name: 'level4.zip', data: level4 }]);
    const level2 = createZipFixture([{ name: 'level3.zip', data: level3 }]);
    const level1 = createZipFixture([{ name: 'level2.zip', data: level2 }]);
    const root = createZipFixture([{ name: 'level1.zip', data: level1 }]);

    const result = await new ZipValidator().validate({
      filename: 'nested.zip',
      buffer: root,
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.ZIP_NESTING_EXCEEDED,
    });
  });

  it('rejects archives with too many entries', async () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({ name: `entry-${index}.txt` }));
    const result = await new ZipValidator().validate({
      filename: 'many.zip',
      buffer: createZipFixture(entries),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.ZIP_BOMB_DETECTED,
    });
  });

  it('rejects forbidden entry types', async () => {
    const result = await new ZipValidator().validate({
      filename: 'forbidden.zip',
      buffer: createZipFixture([{ name: 'payload.exe', data: Buffer.from('MZ') }]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
    });
  });

  it('rejects ZIP entries whose magic bytes do not match the allowed extension', async () => {
    const result = await new ZipValidator().validate({
      filename: 'disguised.zip',
      buffer: createZipFixture([
        {
          name: 'payload.pdf',
          data: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128)]),
        },
      ]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
    });
  });

  it('rejects symlink entries', async () => {
    const result = await new ZipValidator().validate({
      filename: 'links.zip',
      buffer: createZipFixture([
        {
          name: 'link.txt',
          data: Buffer.from('target'),
          externalFileAttributes: 0o120777 << 16,
        },
      ]),
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.ZIP_SYMLINK_DETECTED,
    });
  });
});
