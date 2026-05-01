from __future__ import annotations

import ipaddress
from dataclasses import dataclass

import dns.exception
import dns.resolver

from ..errors import FetchError, SsrfBlockedError
from .ip_validator import IpValidator


@dataclass(frozen=True, slots=True)
class ResolvedAddress:
    ip: str
    original_ip: str


class DnsResolver:
    def __init__(
        self,
        *,
        resolver: dns.resolver.Resolver | None = None,
        ip_validator: IpValidator | None = None,
    ) -> None:
        self.resolver = resolver or dns.resolver.Resolver(configure=True)
        self.ip_validator = ip_validator or IpValidator()

    def resolve(self, hostname: str, *, target_url: str = "") -> list[ResolvedAddress]:
        literal = self._parse_ip_literal(hostname)
        if literal is not None:
            result = self.ip_validator.validate_ip(literal, target_url=target_url)
            return [ResolvedAddress(ip=result.ip, original_ip=result.original_ip)]

        ips: list[str] = []
        errors: list[str] = []
        for record_type in ("A", "AAAA"):
            try:
                answer = self.resolver.resolve(hostname, record_type)
            except dns.resolver.NoAnswer:
                continue
            except dns.resolver.NXDOMAIN as exc:
                raise FetchError(
                    f"DNS lookup failed for {hostname}: NXDOMAIN",
                    retryable=False,
                    cause=exc,
                    target_url=target_url,
                ) from exc
            except dns.exception.Timeout as exc:
                raise FetchError(
                    f"DNS lookup timed out for {hostname}",
                    retryable=True,
                    cause=exc,
                    target_url=target_url,
                ) from exc
            except dns.exception.DNSException as exc:
                errors.append(str(exc))
                continue
            ips.extend(str(item) for item in answer)

        if not ips:
            if errors:
                raise FetchError(
                    f"DNS lookup failed for {hostname}: {'; '.join(errors)}",
                    retryable=True,
                    target_url=target_url,
                )
            raise SsrfBlockedError(
                f"DNS lookup returned no address records for {hostname}",
                target_url=target_url,
                resolved_ip=None,
                block_reason="dns_no_records",
            )

        validated = self.ip_validator.validate_all(ips, target_url=target_url)
        return [
            ResolvedAddress(ip=item.ip, original_ip=item.original_ip)
            for item in validated
        ]

    def _parse_ip_literal(self, hostname: str) -> str | None:
        try:
            return str(ipaddress.ip_address(hostname))
        except ValueError:
            return None
