from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from io import StringIO
from typing import Any, Iterable

import click
import psycopg2
from tabulate import tabulate

from .chart import build_echarts_option
from .validator import SQLValidationError, normalize_table_name, table_is_allowed, validate_sql, validate_table_acl


class CherryDBError(RuntimeError):
    pass


def _json_default(value: Any) -> str | float:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime,)):
        return value.isoformat()
    return str(value)


def _fail(message: str) -> None:
    click.echo(f"ERROR: {message}", err=True)
    raise SystemExit(1)


def _split_csv_env(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def _allowed_tables() -> list[str]:
    return _split_csv_env("CHERRY_DB_ALLOWED_TABLES")


def _masked_columns() -> set[str]:
    masked: set[str] = set()
    for item in _split_csv_env("CHERRY_DB_MASKED_COLUMNS"):
        lowered = item.lower()
        masked.add(lowered)
        masked.add(lowered.rsplit(".", 1)[-1])
    return masked


def _normalize_table_name(name: str) -> str:
    return normalize_table_name(name)


def _split_table_name(name: str) -> tuple[str | None, str]:
    parts = [part.strip().strip('"') for part in name.split(".") if part.strip()]
    if len(parts) == 1:
        return None, parts[0]
    return parts[-2], parts[-1]


def _validate_table_acl(sql: str) -> None:
    validate_table_acl(sql, _allowed_tables())


def _connect():
    dsn = os.environ.get("CHERRY_DB_DSN")
    if not dsn:
        raise CherryDBError("CHERRY_DB_DSN is required")
    try:
        return psycopg2.connect(dsn)
    except Exception as exc:  # pragma: no cover - exercised through CLI tests with mocks
        raise CherryDBError("cannot connect to database") from exc


def _column_names(description: Iterable[Any]) -> list[str]:
    names: list[str] = []
    for column in description:
        if hasattr(column, "name"):
            names.append(column.name)
        else:
            names.append(column[0])
    return names


def _is_timeout_error(exc: Exception) -> bool:
    name = exc.__class__.__name__.lower()
    message = str(exc).lower()
    return "querycanceled" in name or "statement timeout" in message or "canceling statement due to statement timeout" in message


def _emit_audit(sql: str, row_count: int, duration_ms: int) -> None:
    payload = {
        "event": "database_query",
        "sql": sql,
        "row_count": row_count,
        "duration_ms": duration_ms,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    print(json.dumps(payload, ensure_ascii=False, default=_json_default), file=sys.stderr)


def _send_chart_callback(envelope: dict[str, Any]) -> None:
    """POST chart envelope to the internal callback URL. Failures are non-fatal."""
    callback_url = os.environ.get("CHERRY_CHART_CALLBACK_URL", "")
    if not callback_url:
        return

    agent_token = os.environ.get("CHERRY_AGENT_TOKEN", "")
    conversation_id = os.environ.get("CHERRY_CONVERSATION_ID", "")

    if not agent_token or not conversation_id:
        print("WARN: CHERRY_AGENT_TOKEN or CHERRY_CONVERSATION_ID missing - skipping chart callback", file=sys.stderr)
        return

    import urllib.request

    body = json.dumps(
        {
            "conversationId": conversation_id,
            "chart": envelope,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        callback_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {agent_token}",
        },
        method="POST",
    )

    try:
        urllib.request.urlopen(req, timeout=3)
    except Exception as exc:
        print(f"WARN: chart callback failed: {exc}", file=sys.stderr)


def _rows_to_dicts(columns: list[str], rows: Iterable[Iterable[Any]]) -> list[dict[str, Any]]:
    masked = _masked_columns()
    result: list[dict[str, Any]] = []
    for row in rows:
        mapped: dict[str, Any] = {}
        for column, value in zip(columns, row, strict=False):
            mapped[column] = "***" if column.lower() in masked else value
        result.append(mapped)
    return result


def execute_select(sql: str) -> tuple[list[str], list[dict[str, Any]]]:
    try:
        safe_sql = validate_sql(sql).sql
        _validate_table_acl(safe_sql)
    except SQLValidationError as exc:
        raise CherryDBError(str(exc)) from exc

    conn = _connect()
    cursor = None
    started = time.perf_counter()
    row_count = 0
    executed_query = False

    try:
        conn.set_session(readonly=True)
        cursor = conn.cursor()
        cursor.execute("SET statement_timeout = '5s'")
        cursor.execute("SET work_mem = '64MB'")
        wrapped_sql = f"SELECT * FROM ({safe_sql}) AS _q LIMIT 1000"
        executed_query = True
        cursor.execute(wrapped_sql)
        columns = _column_names(cursor.description or [])
        rows = cursor.fetchall()
        row_count = len(rows)
        return columns, _rows_to_dicts(columns, rows)
    except Exception as exc:
        if _is_timeout_error(exc):
            raise CherryDBError("query timeout (5s exceeded)") from exc
        if "read-only" in str(exc).lower():
            raise CherryDBError("cannot execute INSERT/UPDATE/DELETE in read-only transaction") from exc
        raise CherryDBError(str(exc)) from exc
    finally:
        duration_ms = int((time.perf_counter() - started) * 1000)
        if executed_query:
            _emit_audit(safe_sql, row_count, duration_ms)
        if cursor is not None and hasattr(cursor, "close"):
            cursor.close()
        if hasattr(conn, "close"):
            conn.close()


def _render_table(rows: list[dict[str, Any]], columns: list[str]) -> str:
    return tabulate([[row.get(column) for column in columns] for row in rows], headers=columns, tablefmt="simple")


def _render_csv(rows: list[dict[str, Any]], columns: list[str]) -> str:
    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue().rstrip("\r\n")


def _render_json(rows: list[dict[str, Any]]) -> str:
    return json.dumps(rows, ensure_ascii=False, default=_json_default)


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
def main() -> None:
    """Read-only CherryWiki database CLI."""


@main.command("tables")
def tables_command() -> None:
    tables = _allowed_tables()
    if not tables:
        return
    click.echo(tabulate([[table] for table in tables], headers=["Table"], tablefmt="simple"))


@main.command("describe")
@click.argument("table")
def describe_command(table: str) -> None:
    allowed = {_normalize_table_name(item) for item in _allowed_tables()}
    normalized = _normalize_table_name(table)
    if allowed and not table_is_allowed(normalized, allowed):
        _fail(f"table '{table}' not allowed")

    schema, table_name = _split_table_name(table)
    conn = None
    cursor = None
    try:
        conn = _connect()
        cursor = conn.cursor()
        if schema:
            cursor.execute(_DESCRIBE_SQL_WITH_SCHEMA, (schema, table_name))
        else:
            cursor.execute(_DESCRIBE_SQL, (table_name,))
        rows = cursor.fetchall()
        click.echo(tabulate(rows, headers=["Column", "Type", "Comment"], tablefmt="simple"))
    except CherryDBError as exc:
        _fail(str(exc))
    except Exception as exc:
        _fail(str(exc))
    finally:
        if cursor is not None and hasattr(cursor, "close"):
            cursor.close()
        if conn is not None and hasattr(conn, "close"):
            conn.close()


@main.command("query")
@click.argument("sql")
@click.option("--format", "output_format", type=click.Choice(["table", "csv", "json"]), default="table", show_default=True)
def query_command(sql: str, output_format: str) -> None:
    try:
        columns, rows = execute_select(sql)
        if output_format == "json":
            click.echo(_render_json(rows))
        elif output_format == "csv":
            click.echo(_render_csv(rows, columns))
        else:
            click.echo(_render_table(rows, columns))
    except CherryDBError as exc:
        _fail(str(exc))


@main.command("chart")
@click.argument("chart_type", type=click.Choice(["bar", "line", "pie"]))
@click.argument("sql")
def chart_command(chart_type: str, sql: str) -> None:
    try:
        _, rows = execute_select(sql)
        envelope = {
            "type": "cherrywiki.chart",
            "chart_type": chart_type,
            "echarts_option": build_echarts_option(chart_type, rows),
        }
        click.echo(json.dumps(envelope, ensure_ascii=False, default=_json_default))
        _send_chart_callback(envelope)
    except (CherryDBError, ValueError) as exc:
        _fail(str(exc))


_DESCRIBE_SQL = """
SELECT
  c.column_name,
  CASE
    WHEN c.data_type = 'character varying' AND c.character_maximum_length IS NOT NULL
      THEN 'varchar(' || c.character_maximum_length || ')'
    WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL
      THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
    ELSE c.udt_name
  END AS column_type,
  COALESCE(d.description, '') AS comment
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
LEFT JOIN pg_catalog.pg_class cls ON cls.relnamespace = n.oid AND cls.relname = c.table_name
LEFT JOIN pg_catalog.pg_description d ON d.objoid = cls.oid AND d.objsubid = c.ordinal_position
WHERE c.table_name = %s
  AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY c.ordinal_position
"""


_DESCRIBE_SQL_WITH_SCHEMA = """
SELECT
  c.column_name,
  CASE
    WHEN c.data_type = 'character varying' AND c.character_maximum_length IS NOT NULL
      THEN 'varchar(' || c.character_maximum_length || ')'
    WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL
      THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
    ELSE c.udt_name
  END AS column_type,
  COALESCE(d.description, '') AS comment
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
LEFT JOIN pg_catalog.pg_class cls ON cls.relnamespace = n.oid AND cls.relname = c.table_name
LEFT JOIN pg_catalog.pg_description d ON d.objoid = cls.oid AND d.objsubid = c.ordinal_position
WHERE c.table_schema = %s
  AND c.table_name = %s
ORDER BY c.ordinal_position
"""
