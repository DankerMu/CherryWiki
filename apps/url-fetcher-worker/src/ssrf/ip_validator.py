from __future__ import annotations

import ipaddress
from dataclasses import dataclass

from ..errors import SsrfBlockedError


@dataclass(frozen=True, slots=True)
class IpValidationResult:
    ip: str
    original_ip: str
    mapped_ipv6: bool = False


class IpValidator:
    _FORBIDDEN_V4 = (
        (ipaddress.ip_network("127.0.0.0/8"), "private_ip_localhost"),
        (ipaddress.ip_network("10.0.0.0/8"), "private_ip_rfc1918"),
        (ipaddress.ip_network("172.16.0.0/12"), "private_ip_rfc1918"),
        (ipaddress.ip_network("192.168.0.0/16"), "private_ip_rfc1918"),
        (ipaddress.ip_network("169.254.0.0/16"), "link_local_metadata"),
        (ipaddress.ip_network("0.0.0.0/8"), "current_network"),
    )
    _FORBIDDEN_V6 = (
        (ipaddress.ip_network("::1/128"), "ipv6_localhost"),
        (ipaddress.ip_network("fc00::/7"), "ipv6_unique_local"),
        (ipaddress.ip_network("fe80::/10"), "ipv6_link_local"),
    )

    def validate_ip(self, value: str, *, target_url: str = "") -> IpValidationResult:
        original_ip = value
        try:
            parsed = ipaddress.ip_address(value)
        except ValueError as exc:
            raise SsrfBlockedError(
                f"Invalid resolved IP address: {value}",
                target_url=target_url,
                resolved_ip=value,
                block_reason="invalid_ip",
            ) from exc

        mapped_ipv6 = False
        if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
            parsed = parsed.ipv4_mapped
            mapped_ipv6 = True

        reason = self._forbidden_reason(parsed)
        if reason is not None:
            raise SsrfBlockedError(
                f"Blocked forbidden IP address {parsed}",
                target_url=target_url,
                resolved_ip=str(parsed),
                block_reason=self._mapped_reason(reason) if mapped_ipv6 else reason,
            )

        return IpValidationResult(ip=str(parsed), original_ip=original_ip, mapped_ipv6=mapped_ipv6)

    def validate_all(self, values: list[str], *, target_url: str = "") -> list[IpValidationResult]:
        if not values:
            raise SsrfBlockedError(
                "Hostname resolved to no IP addresses",
                target_url=target_url,
                resolved_ip=None,
                block_reason="dns_no_records",
            )
        return [self.validate_ip(value, target_url=target_url) for value in values]

    def _forbidden_reason(self, value: ipaddress._BaseAddress) -> str | None:
        ranges = self._FORBIDDEN_V4 if isinstance(value, ipaddress.IPv4Address) else self._FORBIDDEN_V6
        for network, reason in ranges:
            if value in network:
                return reason
        return None

    def _mapped_reason(self, reason: str) -> str:
        if reason == "link_local_metadata":
            return "ipv4_mapped_ipv6_metadata"
        if reason == "private_ip_rfc1918":
            return "ipv4_mapped_ipv6_private"
        if reason == "private_ip_localhost":
            return "ipv4_mapped_ipv6_localhost"
        return f"ipv4_mapped_ipv6_{reason}"
