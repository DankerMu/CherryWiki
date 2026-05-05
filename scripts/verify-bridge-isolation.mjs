#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const compose = JSON.parse(
  execFileSync('docker', ['compose', '--profile', 'docmost', 'config', '--format', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);

const services = asRecord(compose.services);
const docmost = asRecord(services.docmost);
const profiles = asStringArray(docmost.profiles);
const ports = asArray(docmost.ports);
const dependsOn = asRecord(docmost.depends_on);
const serviceNetworks = asRecord(docmost.networks);
const composeNetworks = asRecord(compose.networks);
const defaultNetwork = asRecord(composeNetworks.default);

if (!profiles.includes('docmost')) {
  fail('docmost service must include the docmost profile');
}

if (ports.length > 0) {
  fail(`docmost must not publish host ports; found ${JSON.stringify(ports)}`);
}

if (!('postgres' in dependsOn) || !('redis' in dependsOn)) {
  fail('docmost must depend on postgres and redis');
}

const networkNames = Object.keys(serviceNetworks);
const defaultNetworkName = typeof defaultNetwork.name === 'string' ? defaultNetwork.name : undefined;
const isOnCherryNet = networkNames.includes('cherry-net') || (networkNames.includes('default') && defaultNetworkName === 'cherry-net');
if (!isOnCherryNet) {
  fail(`docmost must be attached to cherry-net; found ${networkNames.join(', ') || '(none)'}`);
}

console.log('Bridge isolation verified: docmost has no host ports and uses the cherry-net Docker network.');

function fail(message) {
  console.error(`Bridge isolation check failed: ${message}`);
  process.exit(1);
}

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value) {
  return asArray(value).filter((item) => typeof item === 'string');
}
