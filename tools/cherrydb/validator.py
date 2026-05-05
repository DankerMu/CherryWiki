from __future__ import annotations

import re
from dataclasses import dataclass

import sqlparse


class SQLValidationError(ValueError):
    """Raised when a SQL string violates cherrydb's read-only policy."""


WRITE_KEYWORDS = ("INSERT", "UPDATE", "DELETE", "MERGE")


@dataclass(frozen=True)
class ValidatedSQL:
    sql: str


def _strip_comments(sql: str) -> str:
    return sqlparse.format(sql, strip_comments=True)


def _remove_quoted_literals(sql: str) -> str:
    """Remove quoted strings/identifiers so delimiter checks inspect SQL syntax.

    The scanner handles PostgreSQL single-quoted strings, quoted identifiers,
    and dollar-quoted strings. Replaced characters become spaces so word
    boundaries around neighboring SQL tokens remain stable.
    """

    chars: list[str] = []
    index = 0
    length = len(sql)

    while index < length:
        char = sql[index]

        if char == "'":
            chars.append(" ")
            index += 1
            while index < length:
                if sql[index] == "'":
                    chars.append(" ")
                    index += 1
                    if index < length and sql[index] == "'":
                        chars.append(" ")
                        index += 1
                        continue
                    break
                chars.append(" ")
                index += 1
            continue

        if char == '"':
            chars.append(" ")
            index += 1
            while index < length:
                if sql[index] == '"':
                    chars.append(" ")
                    index += 1
                    if index < length and sql[index] == '"':
                        chars.append(" ")
                        index += 1
                        continue
                    break
                chars.append(" ")
                index += 1
            continue

        if char == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[index:])
            if match:
                tag = match.group(0)
                end = sql.find(tag, index + len(tag))
                if end != -1:
                    chars.extend(" " * (end + len(tag) - index))
                    index = end + len(tag)
                    continue

        chars.append(char)
        index += 1

    return "".join(chars)


def sql_without_literals(sql: str) -> str:
    return _remove_quoted_literals(_strip_comments(sql))


def _contains_semicolon_outside_literals(sql: str) -> bool:
    return ";" in sql_without_literals(sql)


def _contains_cte_write(sql: str) -> bool:
    cleaned = sql_without_literals(sql)
    if not re.match(r"^\s*WITH(?:\s+RECURSIVE)?\b", cleaned, re.IGNORECASE):
        return False
    return re.search(r"\b(?:INSERT|UPDATE|DELETE|MERGE)\b", cleaned, re.IGNORECASE) is not None


def validate_sql(sql: str) -> ValidatedSQL:
    stripped = sql.strip()
    if not stripped:
        raise SQLValidationError("SQL is required")

    if _contains_semicolon_outside_literals(stripped):
        raise SQLValidationError("multi-statement SQL rejected")

    parsed = [stmt for stmt in sqlparse.parse(stripped) if str(stmt).strip()]
    if len(parsed) != 1:
        raise SQLValidationError("exactly one SQL statement required")

    statement_type = parsed[0].get_type().upper()
    if statement_type != "SELECT":
        raise SQLValidationError("only SELECT statements allowed")

    if _contains_cte_write(stripped):
        raise SQLValidationError("CTE write operations rejected")

    return ValidatedSQL(stripped)
