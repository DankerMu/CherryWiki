export type ZipFixtureEntry = {
  name: string;
  data?: Buffer;
  compressedSize?: number;
  uncompressedSize?: number;
  externalFileAttributes?: number;
};

type LocalEntryRecord = {
  name: Buffer;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalFileAttributes: number;
  localHeaderOffset: number;
};

export function createZipFixture(entries: readonly ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const records: LocalEntryRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data ?? Buffer.alloc(0);
    const compressedSize = entry.compressedSize ?? data.length;
    const uncompressedSize = entry.uncompressedSize ?? data.length;
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);
    records.push({
      name,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      externalFileAttributes: (entry.externalFileAttributes ?? 0) >>> 0,
      localHeaderOffset: offset,
    });
    offset += localHeader.length + name.length + data.length;
  }

  const centralParts: Buffer[] = [];
  let centralDirectorySize = 0;
  for (const record of records) {
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(record.crc32, 16);
    centralHeader.writeUInt32LE(record.compressedSize, 20);
    centralHeader.writeUInt32LE(record.uncompressedSize, 24);
    centralHeader.writeUInt16LE(record.name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(record.externalFileAttributes, 38);
    centralHeader.writeUInt32LE(record.localHeaderOffset, 42);
    centralParts.push(centralHeader, record.name);
    centralDirectorySize += centralHeader.length + record.name.length;
  }

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(records.length, 8);
  endOfCentralDirectory.writeUInt16LE(records.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});
