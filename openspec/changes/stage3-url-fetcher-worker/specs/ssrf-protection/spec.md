## ADDED Requirements

### Requirement: DNS resolution and IP validation
The url-fetcher-worker SHALL resolve the URL hostname to IP addresses using its own DNS resolver (dnspython) before making any HTTP request. All resolved IPs SHALL be checked against the forbidden IP ranges. If any resolved IP falls within a forbidden range, the request SHALL be blocked.

#### Scenario: Public IP allowed
- **WHEN** url-fetcher-worker resolves "example.com" to a public IP (e.g., 93.184.216.34)
- **THEN** the IP validation passes and the request proceeds

#### Scenario: Localhost blocked (P1-E12)
- **WHEN** url-fetcher-worker resolves a hostname to 127.0.0.1
- **THEN** the request is blocked with error_type="ssrf_blocked", reason="private_ip_localhost", and an audit_log entry is created

#### Scenario: Private IP 10.x blocked (P1-E12)
- **WHEN** url-fetcher-worker resolves a hostname to 10.0.1.5
- **THEN** the request is blocked with error_type="ssrf_blocked", reason="private_ip_rfc1918"

#### Scenario: AWS metadata endpoint blocked (P1-E12)
- **WHEN** url-fetcher-worker resolves a hostname to 169.254.169.254
- **THEN** the request is blocked with error_type="ssrf_blocked", reason="link_local_metadata"

#### Scenario: IPv6 localhost blocked
- **WHEN** url-fetcher-worker resolves a hostname to ::1
- **THEN** the request is blocked with error_type="ssrf_blocked", reason="ipv6_localhost"

#### Scenario: IPv4-mapped IPv6 address blocked (P1-E12 / §4.5C)
- **WHEN** url-fetcher-worker receives a URL like `http://[::ffff:169.254.169.254]/latest/meta-data/`
- **THEN** the IPv4-mapped IPv6 address is canonicalized to its IPv4 equivalent (169.254.169.254), recognized as link-local/metadata, and blocked with error_type="ssrf_blocked", reason="ipv4_mapped_ipv6_metadata"

#### Scenario: IPv4-mapped IPv6 private IP blocked
- **WHEN** url-fetcher-worker resolves a hostname to ::ffff:10.0.0.1
- **THEN** the address is canonicalized to 10.0.0.1, recognized as RFC1918 private, and blocked

### Requirement: DNS pinning
The url-fetcher-worker SHALL pin the resolved IP address after validation and use it directly for the HTTP connection. The worker SHALL NOT perform a second DNS lookup when establishing the TCP connection. This prevents DNS rebinding attacks where the DNS record changes between resolution and connection.

#### Scenario: DNS pinning prevents rebinding (P1-E12)
- **WHEN** url-fetcher-worker resolves "attacker.com" to a public IP, validates it, and then the DNS record changes to 169.254.169.254 before the connection
- **THEN** the worker connects to the original validated public IP, not the rebinding target

### Requirement: Redirect IP re-validation
The url-fetcher-worker SHALL NOT follow HTTP redirects automatically. Instead, it SHALL manually process each redirect (301, 302, 307, 308) by: extracting the Location header, resolving the new hostname, validating the new IP against forbidden ranges, and only then following the redirect. Maximum redirect depth SHALL be 5.

#### Scenario: Redirect to public IP allowed
- **WHEN** url-fetcher-worker follows a redirect from "short.link" to "docs.example.com" (public IP)
- **THEN** the redirect is followed after IP re-validation passes

#### Scenario: Redirect to private IP blocked (P1-E12)
- **WHEN** a URL redirects to a location that resolves to 192.168.1.100
- **THEN** the redirect is blocked with error_type="ssrf_blocked", reason="redirect_to_private_ip", and an audit_log entry records the redirect chain

#### Scenario: Too many redirects
- **WHEN** a URL chain exceeds 5 redirects
- **THEN** the request is aborted with error_type="too_many_redirects"

### Requirement: Forbidden IP ranges
The url-fetcher-worker SHALL block requests to the following IP ranges:
- 127.0.0.0/8 (loopback)
- 10.0.0.0/8 (RFC1918 private)
- 172.16.0.0/12 (RFC1918 private)
- 192.168.0.0/16 (RFC1918 private)
- 169.254.0.0/16 (link-local / cloud metadata)
- 0.0.0.0/8 (current network)
- ::1/128 (IPv6 loopback)
- fc00::/7 (IPv6 unique local)
- fe80::/10 (IPv6 link-local)
- ::ffff:0:0/96 (IPv4-mapped IPv6 — canonicalize to IPv4 and re-check against all IPv4 ranges above)

#### Scenario: All forbidden ranges enforced
- **WHEN** url-fetcher-worker checks IPs from each forbidden range
- **THEN** all are blocked: 127.0.0.1, 10.1.2.3, 172.16.0.1, 192.168.0.1, 169.254.169.254, 0.0.0.1, ::1, fd00::1, fe80::1, ::ffff:169.254.169.254, ::ffff:10.0.0.1

### Requirement: SSRF audit logging
The url-fetcher-worker SHALL write an audit_log entry for every SSRF block event. The audit entry SHALL include: action="upload.ssrf_blocked", source_document_id, target_url, resolved_ip, block_reason, redirect_chain (if applicable).

#### Scenario: Audit log on SSRF block
- **WHEN** an SSRF attempt is blocked
- **THEN** an audit_log entry is created with action="upload.ssrf_blocked", the target URL, the resolved IP, and the block reason

### Requirement: Docker network isolation
The url-fetcher-worker container SHALL run on a dedicated Docker network with restricted egress. The container SHALL only be able to reach: the egress proxy (for outbound HTTP/HTTPS), MinIO (for snapshot storage), and cherry-api internal endpoints (for Job protocol). Direct access to any other internal service SHALL be blocked.

#### Scenario: Internal service access blocked
- **WHEN** url-fetcher-worker attempts to connect to the PostgreSQL database directly
- **THEN** the connection is blocked by Docker network policy

#### Scenario: Outbound HTTP via proxy
- **WHEN** url-fetcher-worker makes an outbound HTTP request to a public URL
- **THEN** the request routes through the egress proxy
