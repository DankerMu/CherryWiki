from __future__ import annotations

import socket
from typing import Any

import urllib3.connection
from requests.adapters import HTTPAdapter
from urllib3 import PoolManager
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.poolmanager import PoolKey, _default_key_normalizer
from urllib3.util import connection


class PinnedIPAdapter(HTTPAdapter):
    def __init__(self, *, pinned_ip: str, server_hostname: str, **kwargs: Any) -> None:
        self.pinned_ip = pinned_ip
        self.server_hostname = server_hostname
        super().__init__(**kwargs)

    def init_poolmanager(self, connections: int, maxsize: int, block: bool = False, **pool_kwargs: Any) -> None:
        pool_kwargs["pinned_ip"] = self.pinned_ip
        pool_kwargs["server_hostname"] = self.server_hostname
        pool_kwargs["assert_hostname"] = self.server_hostname
        pool_manager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, **pool_kwargs)
        pool_manager.pool_classes_by_scheme["http"] = _PinnedHTTPConnectionPool
        pool_manager.pool_classes_by_scheme["https"] = _PinnedHTTPSConnectionPool
        pool_manager.key_fn_by_scheme["http"] = _pool_key_without_pinned_ip
        pool_manager.key_fn_by_scheme["https"] = _pool_key_without_pinned_ip
        self.poolmanager = pool_manager

    def proxy_manager_for(self, proxy: str, **proxy_kwargs: Any) -> PoolManager:
        proxy_kwargs["pinned_ip"] = self.pinned_ip
        proxy_kwargs["server_hostname"] = self.server_hostname
        proxy_kwargs["assert_hostname"] = self.server_hostname
        manager = super().proxy_manager_for(proxy, **proxy_kwargs)
        manager.pool_classes_by_scheme["http"] = _PinnedHTTPConnectionPool
        manager.pool_classes_by_scheme["https"] = _PinnedHTTPSConnectionPool
        manager.key_fn_by_scheme["http"] = _pool_key_without_pinned_ip
        manager.key_fn_by_scheme["https"] = _pool_key_without_pinned_ip
        return manager


class _PinnedHTTPConnection(urllib3.connection.HTTPConnection):
    def __init__(self, *args: Any, pinned_ip: str | None = None, **kwargs: Any) -> None:
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def _new_conn(self) -> socket.socket:
        if self._pinned_ip is None:
            return super()._new_conn()
        return connection.create_connection(
            (self._pinned_ip, self.port),
            self.timeout,
            source_address=self.source_address,
            socket_options=self.socket_options,
        )


class _PinnedHTTPSConnection(urllib3.connection.HTTPSConnection):
    def __init__(self, *args: Any, pinned_ip: str | None = None, **kwargs: Any) -> None:
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def _new_conn(self) -> socket.socket:
        if self._pinned_ip is None or self.proxy is not None:
            return super()._new_conn()
        return connection.create_connection(
            (self._pinned_ip, self.port),
            self.timeout,
            source_address=self.source_address,
            socket_options=self.socket_options,
        )

    def set_tunnel(self, host: str, port: int | None = None, headers: dict[str, str] | None = None, scheme: str = "http") -> None:
        super().set_tunnel(self._pinned_ip or host, port=port, headers=headers, scheme=scheme)


class _PinnedHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = _PinnedHTTPConnection


class _PinnedHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = _PinnedHTTPSConnection


def _pool_key_without_pinned_ip(request_context: dict[str, Any]) -> PoolKey:
    context = request_context.copy()
    context.pop("pinned_ip", None)
    return _default_key_normalizer(PoolKey, context)
