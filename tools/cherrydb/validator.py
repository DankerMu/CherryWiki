from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

import sqlparse
from sqlparse.sql import Function, Identifier, IdentifierList, Parenthesis, TokenList
from sqlparse.tokens import DML, Keyword, Literal, Name, Punctuation


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


def normalize_table_name(name: str) -> str:
    parts = [part.strip().strip('"').replace('""', '"') for part in name.strip().split(".") if part.strip()]
    return ".".join(parts).lower()


def extract_table_references(sql: str) -> set[str]:
    references: set[str] = set()
    parsed = [stmt for stmt in sqlparse.parse(sql) if str(stmt).strip()]

    for statement in parsed:
        references.update(_extract_table_references_from_tokenlist(statement, set()))

    return references


def validate_table_acl(sql: str, allowed_tables: Iterable[str]) -> None:
    allowed = {normalize_table_name(table) for table in allowed_tables if normalize_table_name(table)}
    if not allowed:
        return

    for table in extract_table_references(sql):
        if not table_is_allowed(table, allowed):
            raise SQLValidationError(f"table '{table}' not allowed")


def table_is_allowed(table: str, allowed_tables: Iterable[str]) -> bool:
    normalized = normalize_table_name(table)
    if not normalized:
        return False

    for allowed in {normalize_table_name(item) for item in allowed_tables if normalize_table_name(item)}:
        if "." in allowed:
            if normalized == allowed:
                return True
            continue

        if normalized == allowed or normalized == f"public.{allowed}":
            return True

    return False


def _extract_cte_names(statement: TokenList) -> set[str]:
    names: set[str] = set()
    in_cte = False

    for token in statement.tokens:
        if token.is_whitespace:
            continue

        if not in_cte:
            if token.ttype is Keyword.CTE and token.normalized.upper() == "WITH":
                in_cte = True
            continue

        if token.ttype is DML:
            break

        if token.match(Keyword, "RECURSIVE"):
            continue

        if isinstance(token, IdentifierList):
            for identifier in token.get_identifiers():
                name = identifier.get_real_name() or identifier.get_name()
                if name:
                    names.add(normalize_table_name(name))
            break

        if isinstance(token, Identifier):
            name = token.get_real_name() or token.get_name()
            if name:
                names.add(normalize_table_name(name))
            break

    return names


def _extract_table_references_from_tokenlist(token_list: TokenList, cte_names: set[str]) -> set[str]:
    references: set[str] = set()
    scoped_cte_names = cte_names | _extract_cte_names(token_list)
    tokens = token_list.tokens
    index = 0

    while index < len(tokens):
        token = tokens[index]

        if _is_relation_keyword(token):
            source, source_index = _next_relation_source(tokens, index + 1)
            if source is not None:
                references.update(_extract_table_references_from_source(source, scoped_cte_names))
                index = source_index

        if isinstance(token, TokenList):
            references.update(_extract_table_references_from_tokenlist(token, scoped_cte_names))

        index += 1

    return references


def _extract_table_references_from_source(token: object, cte_names: set[str]) -> set[str]:
    references: set[str] = set()

    if isinstance(token, IdentifierList):
        for identifier in token.get_identifiers():
            references.update(_extract_table_references_from_source(identifier, cte_names))
        return references

    if isinstance(token, Identifier):
        if not _identifier_starts_with_subquery(token):
            table = _relation_name_from_identifier(token)
            if table and table not in cte_names:
                references.add(table)

        references.update(_extract_table_references_from_tokenlist(token, cte_names))
        return references

    if isinstance(token, Parenthesis):
        references.update(_extract_table_references_from_tokenlist(token, cte_names))
        return references

    if isinstance(token, Function):
        name = token.get_name()
        if name:
            references.add(normalize_table_name(name))
        return references

    if isinstance(token, TokenList):
        references.update(_extract_table_references_from_tokenlist(token, cte_names))

    return references


def _is_relation_keyword(token: object) -> bool:
    if not hasattr(token, "normalized"):
        return False

    normalized = token.normalized.upper()  # type: ignore[attr-defined]
    return normalized == "FROM" or normalized.endswith(" JOIN") or normalized == "JOIN"


def _next_relation_source(tokens: list[object], start_index: int) -> tuple[object | None, int]:
    index = start_index
    while index < len(tokens):
        token = tokens[index]
        if getattr(token, "is_whitespace", False):
            index += 1
            continue

        normalized = getattr(token, "normalized", "").upper()
        if normalized in {"LATERAL", "ONLY"}:
            index += 1
            continue

        return token, index

    return None, index


def _identifier_starts_with_subquery(identifier: Identifier) -> bool:
    for token in identifier.tokens:
        if token.is_whitespace:
            continue
        return isinstance(token, Parenthesis) and _contains_select(token)

    return False


def _contains_select(token_list: TokenList) -> bool:
    for token in token_list.flatten():
        if token.ttype is DML and token.normalized.upper() == "SELECT":
            return True
    return False


def _relation_name_from_identifier(identifier: Identifier) -> str | None:
    if _identifier_starts_with_subquery(identifier):
        return None

    for token in identifier.tokens:
        if isinstance(token, Function):
            return normalize_table_name(token.get_name() or "")

    raw_parts: list[str] = []
    saw_name = False

    for token in identifier.tokens:
        if token.is_whitespace:
            if saw_name and not _next_non_whitespace_is_dot(identifier, token):
                break
            continue

        if token.match(Keyword, "AS"):
            break

        if token.ttype is Punctuation and token.value == ".":
            raw_parts.append(".")
            continue

        if _is_name_token(token):
            raw_parts.append(token.value)
            saw_name = True
            continue

        if saw_name:
            break

    raw = "".join(raw_parts).strip()
    if raw:
        return normalize_table_name(raw)

    parent_name = identifier.get_parent_name()
    real_name = identifier.get_real_name()
    if real_name is None:
        return None

    return normalize_table_name(f"{parent_name}.{real_name}" if parent_name else real_name)


def _next_non_whitespace_is_dot(identifier: Identifier, current_token: object) -> bool:
    try:
        index = identifier.token_index(current_token)  # type: ignore[arg-type]
    except ValueError:
        return False

    next_token = identifier.token_next(index, skip_ws=True, skip_cm=True)
    if next_token is None:
        return False

    _, token = next_token
    return token.ttype is Punctuation and token.value == "."


def _is_name_token(token: object) -> bool:
    ttype = getattr(token, "ttype", None)
    return ttype in Name or ttype in Keyword or ttype in Literal.String.Symbol


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
