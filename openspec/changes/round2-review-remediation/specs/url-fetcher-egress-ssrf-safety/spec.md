## ADDED Requirements

### Requirement: Custom SSRF CIDRs are additive to built-in blocks
The URL fetcher SHALL always retain built-in forbidden ranges when custom blocked CIDRs are configured.

Built-in forbidden ranges include IPv4 localhost, RFC1918 private ranges, link-local/metadata ranges, current-network ranges, IPv6 localhost, IPv6 unique-local, IPv6 link-local, and IPv4-mapped IPv6 forms of blocked IPv4 addresses.

#### Scenario: Custom CIDR configured
- **WHEN** `SSRF_BLOCKED_CIDRS=203.0.113.0/24` is configured
- **THEN** `203.0.113.10`, `10.1.2.3`, `127.0.0.1`, and `169.254.169.254` MUST all be blocked

#### Scenario: No custom CIDR configured
- **WHEN** `SSRF_BLOCKED_CIDRS` is unset or empty
- **THEN** built-in forbidden ranges MUST still be blocked and public IPs MAY be allowed

#### Scenario: IPv4-mapped IPv6 private address
- **WHEN** a resolved address is `::ffff:10.0.0.1`
- **THEN** the URL fetcher MUST block it as an IPv4-mapped private address

### Requirement: Invalid custom CIDR configuration fails closed
The URL fetcher SHALL reject malformed custom CIDR configuration during startup or fetcher construction.

#### Scenario: CIDR list contains invalid item
- **WHEN** `SSRF_BLOCKED_CIDRS` contains an invalid network value
- **THEN** URL fetcher startup or configuration construction MUST fail instead of silently ignoring the invalid item

### Requirement: Proxy-required mode never falls back to direct egress
The URL fetcher SHALL fail closed when proxy-required mode is enabled and the proxy is missing or unreachable.

#### Scenario: Proxy required without URL
- **WHEN** `EGRESS_PROXY_REQUIRED=true` and `EGRESS_PROXY_URL` is unset or empty
- **THEN** URL fetcher startup MUST fail with an explicit configuration error

#### Scenario: Proxy required but unreachable
- **WHEN** `EGRESS_PROXY_REQUIRED=true` and the configured proxy cannot be reached
- **THEN** a fetch MUST fail and MUST NOT retry through direct outbound access

### Requirement: Redirect revalidation uses effective target addresses
The URL fetcher SHALL re-resolve and revalidate every redirect target before fetching it.

#### Scenario: Public URL redirects to private address
- **WHEN** an allowed public URL returns a redirect to a hostname or IP that resolves to a private or metadata address
- **THEN** the URL fetcher MUST block the redirect before fetching the private target
