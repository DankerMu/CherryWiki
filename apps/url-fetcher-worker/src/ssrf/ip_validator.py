from __future__ import annotations

import ipaddress
from collections.abc import Sequence
from dataclasses import dataclass

from ..errors import SsrfBlockedError

ForbiddenNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
ForbiddenRange = tuple[ForbiddenNetwork, str]

DEFAULT_FORBIDDEN_V4: tuple[ForbiddenRange, ...] = (
    (ipaddress.ip_network("127.0.0.0/8"), "private_ip_localhost"),
    (ipaddress.ip_network("10.0.0.0/8"), "private_ip_rfc1918"),
    (ipaddress.ip_network("172.16.0.0/12"), "private_ip_rfc1918"),
    (ipaddress.ip_network("192.168.0.0/16"), "private_ip_rfc1918"),
    (ipaddress.ip_network("169.254.0.0/16"), "link_local_metadata"),
    (ipaddress.ip_network("0.0.0.0/8"), "current_network"),
)
DEFAULT_FORBIDDEN_V6: tuple[ForbiddenRange, ...] = (
    (ipaddress.ip_network("::1/128"), "ipv6_localhost"),
    (ipaddress.ip_network("fc00::/7"), "ipv6_unique_local"),
    (ipaddress.ip_network("fe80::/10"), "ipv6_link_local"),
)
DEFAULT_FORBIDDEN_CIDRS = tuple(
    str(network) for network, _reason in DEFAULT_FORBIDDEN_V4 + DEFAULT_FORBIDDEN_V6
)


@dataclass(frozen=True, slots=True)
class IpValidationResult:
    ip: str
    original_ip: str
    mapped_ipv6: bool = False


class IpValidator:
    def __init__(self, forbidden_cidrs: Sequence[str] | None = None) -> None:
        forbidden_v4: list[ForbiddenRange] = list(DEFAULT_FORBIDDEN_V4)
        forbidden_v6: list[ForbiddenRange] = list(DEFAULT_FORBIDDEN_V6)
        if forbidden_cidrs is None:
            self._forbidden_v4 = tuple(forbidden_v4)
            self._forbidden_v6 = tuple(forbidden_v6)
            return

        for cidr in forbidden_cidrs:
            network = ipaddress.ip_network(cidr.strip(), strict=False)
            entry = (network, _default_reason_for_network(network))
            if isinstance(network, ipaddress.IPv4Network):
                forbidden_v4.append(entry)
            else:
                forbidden_v6.append(entry)
        self._forbidden_v4 = tuple(forbidden_v4)
        self._forbidden_v6 = tuple(forbidden_v6)

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

        return IpValidationResult(
            ip=str(parsed), original_ip=original_ip, mapped_ipv6=mapped_ipv6
        )

    def validate_all(
        self, values: list[str], *, target_url: str = ""
    ) -> list[IpValidationResult]:
        if not values:
            raise SsrfBlockedError(
                "Hostname resolved to no IP addresses",
                target_url=target_url,
                resolved_ip=None,
                block_reason="dns_no_records",
            )
        return [self.validate_ip(value, target_url=target_url) for value in values]

    def _forbidden_reason(self, value: ipaddress._BaseAddress) -> str | None:
        ranges = (
            self._forbidden_v4
            if isinstance(value, ipaddress.IPv4Address)
            else self._forbidden_v6
        )
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


def parse_blocked_cidrs(value: str | None) -> tuple[str, ...] | None:
    if value is None or value.strip() == "":
        return None
    cidrs = tuple(item.strip() for item in value.split(",") if item.strip())
    if not cidrs:
        raise ValueError(
            f"SSRF_BLOCKED_CIDRS is set but produced zero valid CIDRs from: {value!r}"
        )
    for cidr in cidrs:
        ipaddress.ip_network(cidr, strict=False)
    return cidrs


def _default_reason_for_network(network: ForbiddenNetwork) -> str:
    for default_network, reason in DEFAULT_FORBIDDEN_V4 + DEFAULT_FORBIDDEN_V6:
        if network == default_network:
            return reason
    return "configured_blocked_cidr"
