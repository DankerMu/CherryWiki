from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, TypedDict


SUBAGENT_TOOL_NAME = "Agent"
ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", SUBAGENT_TOOL_NAME]
CLAUDE_SPAWN_ARGS = [
    "claude",
    "--bare",
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
]

FIRST_GRAPHIFY_MESSAGE = (
    "/graphify ./input --wiki\n\n"
    "Worker mode: run autonomously. Do not ask questions. If the input is too "
    "large or ambiguous, stop with a clear failure reason."
)

GRAPHIFY_RUN_ROOT = Path(os.environ.get("GRAPHIFY_RUN_ROOT", "/work/graphify"))
DEFAULT_TIMEOUT_SECONDS = 3600
DEFAULT_MAX_INPUT_FILES = 150
DEFAULT_MAX_INPUT_WORDS = 1_500_000
_SAFE_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_WAITING_FOR_INPUT_RE = re.compile(
    r"("
    r"\bplease\s+(choose|select|confirm|provide|clarify)\b|"
    r"\bwhich\s+(files?|directory|option|one)\b|"
    r"\bwould\s+you\s+like\b|"
    r"\bdo\s+you\s+want\b|"
    r"\bwaiting\s+for\s+(user\s+)?input\b|"
    r"\bneed\s+(your|user)\s+(input|selection|clarification)\b"
    r")",
    re.IGNORECASE,
)


class RunState(str, Enum):
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    IDLE = "IDLE"
    FINISHING = "FINISHING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class StreamEvent(TypedDict, total=False):
    type: str
    session_id: str | None
    text: str
    tool_uses: list[dict[str, Any]]
    waiting_for_input: bool
    is_error: bool
    message: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class RunDirs:
    run_dir: Path
    session_dir: Path
    input_dir: Path
    home_dir: Path
    config_dir: Path


def prepare_run_dirs(run_id: str) -> RunDirs:
    if not _SAFE_RUN_ID_RE.match(run_id):
        raise ValueError(f"Invalid run_id for path use: {run_id!r}")

    base = _run_root().resolve()
    run_dir = (base / run_id).resolve()
    if not run_dir.is_relative_to(base):
        raise ValueError(f"run_dir escapes base: {run_dir}")

    session_dir = run_dir / "session"
    input_dir = session_dir / "input"
    home_dir = session_dir / ".home"
    config_dir = home_dir / ".claude"

    input_dir.mkdir(parents=True, exist_ok=True)
    config_dir.mkdir(parents=True, exist_ok=True)
    return RunDirs(
        run_dir=run_dir,
        session_dir=session_dir,
        input_dir=input_dir,
        home_dir=home_dir,
        config_dir=config_dir,
    )


def generate_settings(config_dir: Path | str) -> Path:
    config_path = Path(config_dir)
    config_path.mkdir(parents=True, exist_ok=True)
    settings_path = config_path / "settings.json"
    settings = {
        "permissions": {
            "allow": list(ALLOWED_TOOLS),
            "deny": [],
            "defaultMode": "bypassPermissions",
        },
        "allowedTools": list(ALLOWED_TOOLS),
        "dangerouslySkipPermissions": True,
        "disableAllHooks": True,
    }
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings_path


def build_claude_env(
    home_dir: Path | str | None = None, config_dir: Path | str | None = None
) -> dict[str, str]:
    home = str(home_dir or os.environ.get("HOME", ""))
    claude_config = str(
        config_dir
        or os.environ.get("CLAUDE_CONFIG_DIR")
        or (Path(home) / ".claude" if home else "")
    )
    model = os.environ.get("AGENT_ANTHROPIC_MODEL", "deepseek-v4-flash")

    return {
        "HOME": home,
        "CLAUDE_CONFIG_DIR": claude_config,
        "PATH": os.environ.get("PATH", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "TMPDIR": os.environ.get("TMPDIR", tempfile.gettempdir()),
        "DISABLE_AUTOUPDATER": "1",
        "ANTHROPIC_API_KEY": os.environ.get("AGENT_ANTHROPIC_API_KEY", ""),
        "ANTHROPIC_BASE_URL": os.environ.get("AGENT_ANTHROPIC_BASE_URL", ""),
        "ANTHROPIC_MODEL": model,
        "ANTHROPIC_DEFAULT_MODEL": model,
    }


def install_skill(config_dir: Path | str) -> Path:
    config_path = Path(config_dir)
    skill_dst = config_path / "skills" / "graphify" / "SKILL.md"
    skill_dst.parent.mkdir(parents=True, exist_ok=True)

    skill_src = _find_graphify_skill()
    if skill_src is not None:
        shutil.copy2(skill_src, skill_dst)
        (skill_dst.parent / ".graphify_version").write_text(
            "local", encoding="utf-8"
        )
        return skill_dst

    env = {
        "HOME": str(config_path.parent),
        "CLAUDE_CONFIG_DIR": str(config_path),
        "PATH": os.environ.get("PATH", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }
    subprocess.run(
        ["graphify", "install"],
        check=True,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if not skill_dst.exists():
        raise RuntimeError(f"graphify install did not create {skill_dst}")
    return skill_dst


def spawn_claude(
    session_dir: Path | str, config_dir: Path | str, settings_path: Path | str
) -> subprocess.Popen[str]:
    config_path = Path(config_dir)
    args = [
        *CLAUDE_SPAWN_ARGS,
        "--settings",
        str(settings_path),
        "--tools",
        ",".join(ALLOWED_TOOLS),
    ]
    return subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(session_dir),
        env=build_claude_env(config_path.parent, config_path),
        text=True,
        bufsize=1,
    )


def write_user_message(proc: subprocess.Popen[str], text: str) -> None:
    if proc.stdin is None:
        raise RuntimeError("Claude process stdin is not available")

    payload = {"type": "user", "message": {"role": "user", "content": text}}
    line = json.dumps(payload, separators=(",", ":")) + "\n"
    try:
        proc.stdin.write(line)
    except TypeError:
        proc.stdin.write(line.encode("utf-8"))  # type: ignore[arg-type]
    proc.stdin.flush()


def parse_stream_event(line: str | bytes) -> StreamEvent | None:
    if isinstance(line, bytes):
        line = line.decode("utf-8", errors="replace")
    line = line.strip()
    if not line:
        return None

    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict):
        return None

    event_type = payload.get("type")
    if event_type == "system":
        return {
            "type": "system",
            "session_id": _optional_str(payload.get("session_id")),
            "raw": payload,
        }

    if event_type == "assistant":
        text, tool_uses = _assistant_content(payload)
        return {
            "type": "assistant",
            "text": text,
            "tool_uses": tool_uses,
            "waiting_for_input": assistant_waiting_for_input(text),
            "raw": payload,
        }

    if event_type == "result":
        is_error = _result_is_error(payload)
        return {
            "type": "result",
            "is_error": is_error,
            "message": _result_message(payload),
            "raw": payload,
        }

    if event_type == "error":
        return {
            "type": "error",
            "message": _stringify_error(payload.get("error") or payload.get("message")),
            "raw": payload,
        }

    return None


def assistant_waiting_for_input(text: str) -> bool:
    return bool(_WAITING_FOR_INPUT_RE.search(text))


def preflight_check(input_dir: Path | str) -> dict[str, Any]:
    input_path = Path(input_dir)
    if not input_path.is_dir():
        return {
            "ok": False,
            "reason": "input_missing",
            "file_count": 0,
            "total_words": 0,
        }

    max_files = _env_int("GRAPHIFY_MAX_INPUT_FILES", DEFAULT_MAX_INPUT_FILES)
    max_words = _env_int("GRAPHIFY_MAX_INPUT_WORDS", DEFAULT_MAX_INPUT_WORDS)

    files = sorted(path for path in input_path.rglob("*") if path.is_file())
    file_count = len(files)
    if file_count > max_files:
        return {
            "ok": False,
            "reason": "input_too_large",
            "file_count": file_count,
            "total_words": 0,
        }

    total_words = 0
    for path in files:
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
            total_words += len(content.split())
        except OSError:
            continue
        if total_words > max_words:
            return {
                "ok": False,
                "reason": "input_too_large",
                "file_count": file_count,
                "total_words": total_words,
            }

    return {"ok": True, "file_count": file_count, "total_words": total_words}


def output_complete(session_dir: Path | str) -> bool:
    return (Path(session_dir) / "graphify-out" / "graph.json").is_file()


def resolve_idle_state(
    session_dir: Path | str,
    *,
    assistant_waiting_for_input: bool,
    proc: subprocess.Popen[str] | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    if output_complete(session_dir):
        _request_terminate(proc)
        output_dir = Path(session_dir) / "graphify-out"
        return {
            "status": "success",
            "state": RunState.SUCCEEDED.value,
            "session_id": session_id,
            "output_dir": str(output_dir),
            "graph_json_path": str(output_dir / "graph.json"),
            "wiki_output_path": str(output_dir / "wiki"),
            "report_path": str(output_dir / "GRAPH_REPORT.md"),
        }

    _request_terminate(proc)
    if assistant_waiting_for_input:
        return {
            "status": "failed",
            "state": RunState.FAILED.value,
            "reason": "requires_interaction",
            "retryable": False,
            "session_id": session_id,
        }

    return {
        "status": "failed",
        "state": RunState.FAILED.value,
        "reason": "empty_output",
        "retryable": False,
        "session_id": session_id,
    }


async def run_graphify(
    run_id: str, input_dir: Path | str, *, timeout: float | None = None
) -> dict[str, Any]:
    if os.environ.get("GRAPHIFY_RUNNER_MODE", "claude_code") == "disabled":
        return {"reason": "runner_disabled", "retryable": True}

    if not os.environ.get("AGENT_ANTHROPIC_API_KEY") or not os.environ.get(
        "AGENT_ANTHROPIC_BASE_URL"
    ):
        return {"reason": "missing_api_key"}

    preflight = preflight_check(input_dir)
    if not preflight.get("ok"):
        return preflight

    dirs = prepare_run_dirs(run_id)
    _copy_inputs(Path(input_dir), dirs.input_dir)
    install_skill(dirs.config_dir)
    settings_path = generate_settings(dirs.config_dir)
    proc = spawn_claude(dirs.session_dir, dirs.config_dir, settings_path)
    write_user_message(proc, FIRST_GRAPHIFY_MESSAGE)

    timeout_seconds = timeout
    if timeout_seconds is None:
        timeout_seconds = _env_int("GRAPHIFY_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)

    return await _run_stream_loop(proc, dirs.session_dir, float(timeout_seconds))


async def _run_stream_loop(
    proc: subprocess.Popen[str], session_dir: Path, timeout_seconds: float
) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    state = RunState.STARTING
    session_id: str | None = None
    waiting_for_input = False

    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            return await _terminate_for_timeout(proc)

        try:
            line = await asyncio.wait_for(
                asyncio.to_thread(_read_stdout_line, proc),
                timeout=remaining,
            )
        except TimeoutError:
            return await _terminate_for_timeout(proc)

        if line == "":
            if output_complete(session_dir):
                return resolve_idle_state(
                    session_dir,
                    assistant_waiting_for_input=False,
                    proc=proc,
                    session_id=session_id,
                )
            return {
                "status": "failed",
                "state": RunState.FAILED.value,
                "reason": "claude_exited",
                "retryable": True,
                "session_id": session_id,
            }

        event = parse_stream_event(line)
        if event is None:
            continue

        if event["type"] == "system":
            session_id = event.get("session_id")
            state = RunState.RUNNING
            continue

        if event["type"] == "assistant":
            state = RunState.RUNNING
            waiting_for_input = waiting_for_input or bool(
                event.get("waiting_for_input")
            )
            continue

        if event["type"] == "error":
            _request_terminate(proc)
            await _wait_for_process_exit(proc, 10)
            return {
                "status": "failed",
                "state": RunState.FAILED.value,
                "reason": "claude_error",
                "message": event.get("message", ""),
                "retryable": True,
                "session_id": session_id,
            }

        if event["type"] == "result":
            if event.get("is_error"):
                _request_terminate(proc)
                await _wait_for_process_exit(proc, 10)
                return {
                    "status": "failed",
                    "state": RunState.FAILED.value,
                    "reason": "claude_result_error",
                    "message": event.get("message", ""),
                    "retryable": True,
                    "session_id": session_id,
                }

            state = RunState.IDLE
            result = resolve_idle_state(
                session_dir,
                assistant_waiting_for_input=waiting_for_input,
                proc=proc,
                session_id=session_id,
            )
            await _wait_for_process_exit(proc, 10)
            return result

        if state == RunState.FAILED:
            return {
                "status": "failed",
                "state": RunState.FAILED.value,
                "reason": "unknown",
                "retryable": True,
                "session_id": session_id,
            }


async def _terminate_for_timeout(proc: subprocess.Popen[str]) -> dict[str, Any]:
    _request_terminate(proc)
    try:
        await _wait_for_process_exit(proc, 10)
    except TimeoutError:
        _request_kill(proc)
        await _wait_for_process_exit(proc, 10)
    return {
        "status": "failed",
        "state": RunState.FAILED.value,
        "reason": "timeout",
        "retryable": True,
    }


async def _wait_for_process_exit(
    proc: subprocess.Popen[str], timeout: float
) -> int | None:
    wait = getattr(proc, "wait", None)
    if wait is None:
        return None
    return await asyncio.wait_for(asyncio.to_thread(wait), timeout=timeout)


def _request_terminate(proc: subprocess.Popen[str] | None) -> None:
    if proc is None:
        return
    poll = getattr(proc, "poll", None)
    if poll is not None and poll() is not None:
        return
    terminate = getattr(proc, "terminate", None)
    if terminate is not None:
        terminate()


def _request_kill(proc: subprocess.Popen[str]) -> None:
    kill = getattr(proc, "kill", None)
    if kill is not None:
        kill()


def _read_stdout_line(proc: subprocess.Popen[str]) -> str:
    if proc.stdout is None:
        return ""
    return proc.stdout.readline()


def _copy_inputs(src_dir: Path, dst_dir: Path) -> None:
    if src_dir.resolve() == dst_dir.resolve():
        return
    for src in src_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(src_dir)
        dst = dst_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def _assistant_content(payload: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    content = message.get("content", payload.get("content", []))
    texts: list[str] = []
    tool_uses: list[dict[str, Any]] = []

    if isinstance(payload.get("text"), str):
        texts.append(payload["text"])
    if isinstance(content, str):
        texts.append(content)
    elif isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "text" and isinstance(item.get("text"), str):
                texts.append(item["text"])
            elif item_type in {"tool_use", "toolUse"}:
                tool_uses.append(item)

    return "\n".join(texts), tool_uses


def _result_is_error(payload: dict[str, Any]) -> bool:
    result = payload.get("result")
    if isinstance(result, dict) and "is_error" in result:
        return bool(result["is_error"])
    if "is_error" in payload:
        return bool(payload["is_error"])

    subtype = _optional_str(payload.get("subtype"))
    if subtype is None and isinstance(result, dict):
        subtype = _optional_str(result.get("subtype"))
    if subtype is None:
        return False
    subtype = subtype.lower()
    return subtype.startswith("error") or subtype in {"failed", "failure"}


def _result_message(payload: dict[str, Any]) -> str:
    result = payload.get("result")
    if isinstance(result, dict):
        for key in ("message", "error", "error_message"):
            if result.get(key):
                return _stringify_error(result[key])
    for key in ("message", "error", "error_message"):
        if payload.get(key):
            return _stringify_error(payload[key])
    if isinstance(result, str):
        return result
    return ""


def _stringify_error(error: Any) -> str:
    if error is None:
        return ""
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        message = error.get("message") or error.get("error")
        if message:
            return str(message)
    return json.dumps(error, sort_keys=True)


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _run_root() -> Path:
    return Path(os.environ.get("GRAPHIFY_RUN_ROOT", str(GRAPHIFY_RUN_ROOT)))


def _find_graphify_skill() -> Path | None:
    env_path = os.environ.get("GRAPHIFY_SKILL_PATH")
    candidates: list[Path] = []
    if env_path:
        candidates.append(Path(env_path))

    repo_root = Path(__file__).resolve().parents[3]
    candidates.append(repo_root / "external" / "graphify" / "graphify" / "skill.md")

    try:
        import graphify  # type: ignore[import-not-found]

        candidates.append(Path(graphify.__file__).resolve().parent / "skill.md")
    except Exception:
        pass

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None
