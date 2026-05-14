from __future__ import annotations

import pytest

from src.errors import SsrfBlockedError
from src.ssrf import IpValidator, parse_blocked_cidrs


@pytest.mark.parametrize(
    ("ip", "reason"),
    [
        ("127.0.0.1", "private_ip_localhost"),
        ("10.1.2.3", "private_ip_rfc1918"),
        ("172.16.0.1", "private_ip_rfc1918"),
        ("192.168.0.1", "private_ip_rfc1918"),
        ("169.254.169.254", "link_local_metadata"),
        ("0.0.0.1", "current_network"),
        ("::1", "ipv6_localhost"),
        ("fd00::1", "ipv6_unique_local"),
        ("fe80::1", "ipv6_link_local"),
        ("::ffff:169.254.169.254", "ipv4_mapped_ipv6_metadata"),
        ("::ffff:10.0.0.1", "ipv4_mapped_ipv6_private"),
    ],
)
def test_forbidden_ip_ranges_are_blocked(ip: str, reason: str) -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        IpValidator().validate_ip(ip, target_url="http://target.test")

    assert exc.value.error_type == "ssrf_blocked"
    assert exc.value.metadata["block_reason"] == reason


def test_public_ip_is_allowed() -> None:
    result = IpValidator().validate_ip("93.184.216.34")
    assert result.ip == "93.184.216.34"


@pytest.mark.parametrize(
    ("ip", "reason"),
    [
        ("203.0.113.10", "configured_blocked_cidr"),
        ("10.1.2.3", "private_ip_rfc1918"),
        ("127.0.0.1", "private_ip_localhost"),
        ("169.254.169.254", "link_local_metadata"),
        ("::ffff:10.0.0.1", "ipv4_mapped_ipv6_private"),
    ],
)
def test_custom_blocked_cidrs_append_to_defaults(ip: str, reason: str) -> None:
    validator = IpValidator(forbidden_cidrs=("203.0.113.0/24",))

    with pytest.raises(SsrfBlockedError) as exc:
        validator.validate_ip(ip, target_url="http://target.test")

    assert exc.value.metadata["block_reason"] == reason


@pytest.mark.parametrize("forbidden_cidrs", [None, ()])
def test_default_ranges_apply_without_custom_cidrs(
    forbidden_cidrs: tuple[str, ...] | None,
) -> None:
    validator = IpValidator(forbidden_cidrs=forbidden_cidrs)

    with pytest.raises(SsrfBlockedError) as exc:
        validator.validate_ip("10.1.2.3", target_url="http://target.test")

    assert exc.value.metadata["block_reason"] == "private_ip_rfc1918"
    assert validator.validate_ip("93.184.216.34").ip == "93.184.216.34"


def test_parse_blocked_cidrs_rejects_empty_parsed_value() -> None:
    with pytest.raises(ValueError) as exc:
        parse_blocked_cidrs(",")

    assert "produced zero valid CIDRs" in str(exc.value)


def test_parse_blocked_cidrs_rejects_invalid_cidr() -> None:
    with pytest.raises(ValueError):
        parse_blocked_cidrs("203.0.113.0/24,not-a-cidr")
