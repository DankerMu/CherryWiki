from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import click
import requests


class CherryWikiError(RuntimeError):
    pass


def _fail(message: str) -> None:
    click.echo(f"ERROR: {message}", err=True)
    raise SystemExit(1)


def _api_base() -> str:
    base = os.environ.get("CHERRY_API_INTERNAL_URL", "").strip()
    if not base:
        raise CherryWikiError("CHERRY_API_INTERNAL_URL is required")
    return base.rstrip("/")


def _auth_headers() -> dict[str, str]:
    token = os.environ.get("CHERRY_AGENT_TOKEN", "").strip()
    if not token:
        raise CherryWikiError("CHERRY_AGENT_TOKEN is required")
    return {"Authorization": f"Bearer {token}"}


def _handle_response(response: requests.Response) -> Any:
    if response.status_code in {401, 403}:
        raise CherryWikiError("authentication failed")
    if response.status_code >= 400:
        message = response.text.strip() or response.reason or "request failed"
        raise CherryWikiError(f"request failed ({response.status_code}): {message}")
    return response.json()


def _score_text(score: Any) -> str:
    if isinstance(score, (int, float)):
        return f"{score:.2f}"
    return str(score) if score is not None else "n/a"


def _result_content(result: dict[str, Any]) -> str:
    return (
        result.get("content")
        or result.get("snippet")
        or result.get("text")
        or result.get("chunk")
        or ""
    )


def _result_title(result: dict[str, Any]) -> str:
    page = result.get("page")
    if isinstance(page, dict):
        return page.get("title") or page.get("name") or "Untitled"
    return result.get("page_title") or result.get("title") or "Untitled"


def _result_page_id(result: dict[str, Any]) -> str:
    page = result.get("page")
    if isinstance(page, dict) and page.get("id") is not None:
        return str(page["id"])
    return str(result.get("page_id") or result.get("id") or "")


def _print_search_results(results: list[dict[str, Any]]) -> None:
    for index, result in enumerate(results, start=1):
        title = _result_title(result)
        page_id = _result_page_id(result)
        score = _score_text(result.get("score"))
        heading = f"{index}. {title}"
        if page_id:
            heading += f" [{page_id}]"
        heading += f" score={score}"
        click.echo(heading)

        section = result.get("section_title") or result.get("section") or result.get("heading")
        if section:
            click.echo(f"   Section: {section}")

        content = _result_content(result).strip()
        if content:
            click.echo(f"   {content}")
        if index != len(results):
            click.echo()


def _find_section(data: dict[str, Any], section: str) -> dict[str, Any] | None:
    for item in data.get("sections", []) or []:
        if not isinstance(item, dict):
            continue
        identifiers = {
            str(item.get("id", "")),
            str(item.get("section_id", "")),
            str(item.get("slug", "")),
            str(item.get("title", "")),
            str(item.get("heading", "")),
        }
        if section in identifiers:
            return item
    return None


def _page_content(data: dict[str, Any], section: str | None = None) -> str:
    if section:
        selected = _find_section(data, section)
        if selected is not None:
            return str(
                selected.get("content")
                or selected.get("markdown")
                or selected.get("body")
                or selected.get("text")
                or ""
            )

    return str(
        data.get("content")
        or data.get("markdown")
        or data.get("body")
        or data.get("text")
        or ""
    )


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
def main() -> None:
    """CherryWiki internal search/page CLI."""


@main.command("search")
@click.argument("query")
@click.option("--space", help="Restrict search to a space id.")
@click.option("--top", type=int, default=10, show_default=True, help="Maximum number of results.")
def search_command(query: str, space: str | None, top: int) -> None:
    try:
        params: dict[str, Any] = {"query": query, "top_k": top}
        if space:
            params["space_ids"] = space
        response = requests.get(
            f"{_api_base()}/api/internal/search",
            params=params,
            headers=_auth_headers(),
            timeout=30,
        )
        data = _handle_response(response)
        results = data if isinstance(data, list) else data.get("results", [])
        _print_search_results(results)
    except (CherryWikiError, requests.RequestException, ValueError) as exc:
        _fail(str(exc))


@main.command("page")
@click.argument("page_id")
@click.option("--section", help="Read a specific section id/slug/title.")
def page_command(page_id: str, section: str | None) -> None:
    try:
        params = {"section": section} if section else None
        response = requests.get(
            f"{_api_base()}/api/internal/pages/{quote(page_id, safe='')}",
            params=params,
            headers=_auth_headers(),
            timeout=30,
        )
        data = _handle_response(response)
        content = _page_content(data, section)
        click.echo(content)
    except (CherryWikiError, requests.RequestException, ValueError) as exc:
        _fail(str(exc))
