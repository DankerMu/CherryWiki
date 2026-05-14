import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

const ADMIN_OUTBOUND_PROBE_ALLOWLIST_ENV = 'ADMIN_OUTBOUND_PROBE_ALLOWLIST';
const SAFE_VALIDATION_PREFIX = 'Outbound probe target rejected';
const MAX_SAFE_ERROR_LENGTH = 180;
const DEFAULT_DNS_TIMEOUT_MS = 3000;

type IpVersion = 4 | 6;

type CidrRule =
  | {
      version: 4;
      base: number;
      prefix: number;
    }
  | {
      version: 6;
      base: bigint;
      prefix: number;
    };

type ParsedAllowlist = {
  hosts: Set<string>;
  cidrs: CidrRule[];
};

type OutboundProbeDispatcher = NonNullable<RequestInit['dispatcher']> & {
  close: () => Promise<void>;
};

export type OutboundProbeValidationOptions = {
  dnsTimeoutMs?: number;
};

export type OutboundProbeValidationResult =
  | {
      ok: true;
      url: URL;
      dispatcher: OutboundProbeDispatcher;
    }
  | {
      ok: false;
      error: string;
    };

export async function validateAdminOutboundProbeUrl(
  rawUrl: string,
  options: OutboundProbeValidationOptions = {},
): Promise<OutboundProbeValidationResult> {
  const url = parseUrl(rawUrl);
  if (url === null) {
    return reject('invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return reject('unsupported URL scheme');
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return reject('URL credentials are not allowed');
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) {
    return reject('missing host');
  }

  const allowlist = parseAdminOutboundProbeAllowlist();
  const resolved = await resolveTargetAddresses(hostname, normalizeDnsTimeoutMs(options.dnsTimeoutMs));
  if (resolved.timedOut) {
    return reject('DNS resolution timed out');
  }

  const { addresses } = resolved;
  if (addresses.length === 0) {
    return reject('host could not be resolved');
  }

  const unsafeAddress = addresses.find((address) => isUnsafeIpAddress(address));
  if (unsafeAddress !== undefined && !isAllowlisted(hostname, addresses, allowlist)) {
    return reject('host resolves to a blocked private or local address');
  }

  return { ok: true, url, dispatcher: createValidatedProbeDispatcher(hostname, addresses) };
}

export function sanitizeOutboundProbeError(err: unknown, sensitiveValues: string[] = []): string {
  const raw = err instanceof Error ? err.message : String(err);
  const normalized = raw.replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    return 'Outbound request failed';
  }

  if (containsSecretOrRequestMetadata(normalized, sensitiveValues)) {
    return 'Outbound request failed';
  }

  return normalized.slice(0, MAX_SAFE_ERROR_LENGTH);
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function reject(reason: string): OutboundProbeValidationResult {
  return {
    ok: false,
    error: `${SAFE_VALIDATION_PREFIX}: ${reason}`,
  };
}

function normalizeDnsTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  return DEFAULT_DNS_TIMEOUT_MS;
}

async function resolveTargetAddresses(
  hostname: string,
  timeoutMs: number,
): Promise<{ addresses: string[]; timedOut: boolean }> {
  if (isIP(hostname) !== 0) {
    return { addresses: [hostname], timedOut: false };
  }

  if (isBlockedHostname(hostname)) {
    return { addresses: ['127.0.0.1'], timedOut: false };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const lookupPromise = dnsLookup(hostname, { all: true, verbatim: true })
    .then((records) => ({
      addresses: records.map((record) => record.address),
      timedOut: false,
    }))
    .catch(() => ({ addresses: [], timedOut: false }));
  const timeoutPromise = new Promise<{ addresses: string[]; timedOut: boolean }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ addresses: [], timedOut: true });
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function createValidatedProbeDispatcher(hostname: string, addresses: string[]): OutboundProbeDispatcher {
  const lookupRecords: LookupAddress[] = addresses.map((address) => ({
    address,
    family: isIP(address) as 4 | 6,
  }));

  return new Agent({
    connect: {
      lookup: (requestHostname, options, callback) => {
        if (normalizeHostname(requestHostname) !== hostname) {
          callback(createLookupRejectedError(), []);
          return;
        }

        const family = typeof options.family === 'number' ? options.family : 0;
        const records = family === 0 ? lookupRecords : lookupRecords.filter((record) => record.family === family);
        if (records.length === 0) {
          callback(createLookupRejectedError(), []);
          return;
        }

        if (options.all === true) {
          callback(null, records);
          return;
        }

        const record = records[0];
        if (record === undefined) {
          callback(createLookupRejectedError(), []);
          return;
        }

        callback(null, record.address, record.family);
      },
    },
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    pipelining: 0,
  }) as unknown as OutboundProbeDispatcher;
}

function createLookupRejectedError(): NodeJS.ErrnoException {
  const err = new Error(`${SAFE_VALIDATION_PREFIX}: fetch-time DNS decision was not validated`) as NodeJS.ErrnoException;
  err.code = 'ERR_OUTBOUND_PROBE_BLOCKED';
  return err;
}

function parseAdminOutboundProbeAllowlist(): ParsedAllowlist {
  const hosts = new Set<string>();
  const cidrs: CidrRule[] = [];
  const raw = process.env[ADMIN_OUTBOUND_PROBE_ALLOWLIST_ENV]?.trim();
  if (raw === undefined || raw.length === 0) {
    return { hosts, cidrs };
  }

  for (const entry of raw.split(',')) {
    const normalizedEntry = entry.trim();
    if (normalizedEntry.length === 0) {
      continue;
    }

    const cidr = parseCidrRule(normalizedEntry);
    if (cidr !== null) {
      cidrs.push(cidr);
      continue;
    }

    const hostname = normalizeAllowlistHost(normalizedEntry);
    if (hostname.length > 0) {
      hosts.add(hostname);
    }
  }

  return { hosts, cidrs };
}

function normalizeAllowlistHost(entry: string): string {
  const parsedUrl = parseUrl(entry);
  if (parsedUrl !== null) {
    return normalizeHostname(parsedUrl.hostname);
  }

  return normalizeHostname(entry);
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const unbracketed = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
}

function isAllowlisted(hostname: string, addresses: string[], allowlist: ParsedAllowlist): boolean {
  if (allowlist.hosts.has(hostname)) {
    return true;
  }

  return addresses.every((address) => allowlist.cidrs.some((cidr) => isIpInCidr(address, cidr)));
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata' ||
    hostname === 'metadata.google.internal'
  );
}

function isUnsafeIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const numeric = ipv4ToNumber(address);
    return numeric === null ? true : isUnsafeIpv4Number(numeric);
  }

  if (version === 6) {
    const mappedIpv4 = ipv4MappedIpv6ToIpv4(address);
    if (mappedIpv4 !== null) {
      return isUnsafeIpAddress(mappedIpv4);
    }

    const numeric = ipv6ToBigInt(address);
    return numeric === null ? true : isUnsafeIpv6Number(numeric);
  }

  return true;
}

function isUnsafeIpv4Number(value: number): boolean {
  return (
    isIpv4InRange(value, '0.0.0.0', 8) ||
    isIpv4InRange(value, '10.0.0.0', 8) ||
    isIpv4InRange(value, '100.64.0.0', 10) ||
    isIpv4InRange(value, '127.0.0.0', 8) ||
    isIpv4InRange(value, '169.254.0.0', 16) ||
    isIpv4InRange(value, '172.16.0.0', 12) ||
    isIpv4InRange(value, '192.168.0.0', 16) ||
    value === ipv4ToNumber('100.100.100.200')
  );
}

function isUnsafeIpv6Number(value: bigint): boolean {
  return (
    isIpv6InRange(value, '::', 128) ||
    isIpv6InRange(value, '::1', 128) ||
    isIpv6InRange(value, 'fc00::', 7) ||
    isIpv6InRange(value, 'fe80::', 10)
  );
}

function parseCidrRule(entry: string): CidrRule | null {
  const [address, prefixRaw, extra] = entry.split('/');
  if (address === undefined || prefixRaw === undefined || extra !== undefined) {
    return null;
  }

  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix)) {
    return null;
  }

  const normalizedAddress = normalizeHostname(address);
  const version = isIP(normalizedAddress) as IpVersion | 0;
  if (version === 4) {
    const base = ipv4ToNumber(normalizedAddress);
    if (base === null || prefix < 0 || prefix > 32) {
      return null;
    }

    return { version, base, prefix };
  }

  if (version === 6) {
    const base = ipv6ToBigInt(normalizedAddress);
    if (base === null || prefix < 0 || prefix > 128) {
      return null;
    }

    return { version, base, prefix };
  }

  return null;
}

function isIpInCidr(address: string, cidr: CidrRule): boolean {
  const mappedIpv4 = ipv4MappedIpv6ToIpv4(address);
  const normalizedAddress = mappedIpv4 ?? address;

  if (cidr.version === 4) {
    const numeric = ipv4ToNumber(normalizedAddress);
    if (numeric === null) {
      return false;
    }

    return isIpv4InRange(numeric, numberToIpv4(cidr.base), cidr.prefix);
  }

  const numeric = ipv6ToBigInt(normalizedAddress);
  if (numeric === null) {
    return false;
  }

  return isIpv6InRange(numeric, bigIntToIpv6(cidr.base), cidr.prefix);
}

function isIpv4InRange(value: number, baseAddress: string, prefix: number): boolean {
  const base = ipv4ToNumber(baseAddress);
  if (base === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isIpv6InRange(value: bigint, baseAddress: string, prefix: number): boolean {
  const base = ipv6ToBigInt(baseAddress);
  if (base === null) {
    return false;
  }

  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (value & mask) === (base & mask);
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }

    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    result = (result << 8) + octet;
  }

  return result >>> 0;
}

function numberToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function ipv4MappedIpv6ToIpv4(address: string): string | null {
  const parts = parseIpv6Parts(address);
  if (parts === null) {
    return null;
  }

  const isMapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (!isMapped) {
    return null;
  }

  const part6 = parts[6];
  const part7 = parts[7];
  if (part6 === undefined || part7 === undefined) {
    return null;
  }

  return `${(part6 >>> 8) & 255}.${part6 & 255}.${(part7 >>> 8) & 255}.${part7 & 255}`;
}

function ipv6ToBigInt(address: string): bigint | null {
  const parts = parseIpv6Parts(address);
  if (parts === null) {
    return null;
  }

  return parts.reduce((value, part) => (value << 16n) + BigInt(part), 0n);
}

function parseIpv6Parts(address: string): number[] | null {
  const normalizedAddress = normalizeIpv6Address(address);
  if (normalizedAddress === null) {
    return null;
  }

  const pieces = normalizedAddress.split('::');
  if (pieces.length > 2) {
    return null;
  }

  const left = parseIpv6Hextets(pieces[0] ?? '');
  const right = parseIpv6Hextets(pieces[1] ?? '');
  if (left === null || right === null) {
    return null;
  }

  if (pieces.length === 1) {
    return left.length === 8 ? left : null;
  }

  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 1) {
    return null;
  }

  return [...left, ...Array<number>(zeroCount).fill(0), ...right];
}

function normalizeIpv6Address(address: string): string | null {
  const lower = normalizeHostname(address);
  if (!lower.includes('.')) {
    return lower;
  }

  const lastColon = lower.lastIndexOf(':');
  if (lastColon === -1) {
    return null;
  }

  const ipv4 = lower.slice(lastColon + 1);
  const ipv4Number = ipv4ToNumber(ipv4);
  if (ipv4Number === null) {
    return null;
  }

  const high = ((ipv4Number >>> 16) & 0xffff).toString(16);
  const low = (ipv4Number & 0xffff).toString(16);
  return `${lower.slice(0, lastColon)}:${high}:${low}`;
}

function parseIpv6Hextets(value: string): number[] | null {
  if (value.length === 0) {
    return [];
  }

  const hextets: number[] = [];
  for (const part of value.split(':')) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }

    hextets.push(Number.parseInt(part, 16));
  }

  return hextets;
}

function bigIntToIpv6(value: bigint): string {
  const parts: string[] = [];
  for (let shift = 112; shift >= 0; shift -= 16) {
    parts.push(Number((value >> BigInt(shift)) & 0xffffn).toString(16));
  }

  return parts.join(':');
}

function containsSecretOrRequestMetadata(message: string, sensitiveValues: string[]): boolean {
  if (sensitiveValues.some((value) => value.trim().length > 0 && message.includes(value.trim()))) {
    return true;
  }

  return (
    /\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|bearer|headers?|request init|request metadata|credentials?)\b/i.test(
      message,
    ) ||
    /https?:\/\/[^\s/@?#]+(?::[^\s/@?#]*)?@/i.test(message) ||
    /(?:^|[?&;\s])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|password|secret|credentials?)=[^\s&]+/i.test(
      message,
    ) ||
    /\b(?:sk|pk|rk)-[a-z0-9][a-z0-9_-]{8,}\b/i.test(message) ||
    /\b[A-Za-z0-9_-]{32,}\b/.test(message)
  );
}
