from __future__ import annotations

import asyncio
import io
import json
import sys
import time
from pathlib import Path
from typing import Any

import pytest

from src import claude_runner


def test_generate_settings_does_not_contain_api_key_strings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGENT_ANTHROPIC_API_KEY", "secret-api-key")
    monkeypatch.setenv("DATABASE_URL", "postgres://secret-db")
    monkeypatch.setenv("MINIO_SECRET_KEY", "secret-minio")
    monkeypatch.setenv("WORKER_API_KEY", "secret-worker")

    settings_path = claude_runner.generate_settings(tmp_path / ".claude")

    content = settings_path.read_text(encoding="utf-8")
    assert "secret-api-key" not in content
    assert "secret-db" not in content
    assert "secret-minio" not in content
    assert "secret-worker" not in content


def test_build_claude_env_uses_allowlist_and_maps_agent_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "home" / ".claude"))
    monkeypatch.setenv("PATH", "/usr/bin")
    monkeypatch.setenv("LANG", "C.UTF-8")
    monkeypatch.setenv("TMPDIR", str(tmp_path / "tmp"))
    monkeypatch.setenv("AGENT_ANTHROPIC_API_KEY", "agent-key")
    monkeypatch.setenv("AGENT_ANTHROPIC_BASE_URL", "https://agent.test")
    monkeypatch.setenv("AGENT_ANTHROPIC_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("DATABASE_URL", "postgres://db")
    monkeypatch.setenv("MINIO_ACCESS_KEY", "minio-access")
    monkeypatch.setenv("MINIO_SECRET_KEY", "minio-secret")
    monkeypatch.setenv("WORKER_API_KEY", "worker-secret")

    env = claude_runner.build_claude_env()

    assert env["ANTHROPIC_API_KEY"] == "agent-key"
    assert env["ANTHROPIC_BASE_URL"] == "https://agent.test"
    assert env["ANTHROPIC_MODEL"] == "deepseek-v4-flash"
    assert env["ANTHROPIC_DEFAULT_MODEL"] == "deepseek-v4-flash"
    assert env["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "deepseek-v4-flash"
    assert env["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "deepseek-v4-flash"
    assert env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "deepseek-v4-flash"
    assert "DATABASE_URL" not in env
    assert "WORKER_API_KEY" not in env
    assert not any(key.startswith("MINIO_") for key in env)
    assert set(env) == {
        "HOME",
        "CLAUDE_CONFIG_DIR",
        "PATH",
        "LANG",
        "TMPDIR",
        "DISABLE_AUTOUPDATER",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    }


def test_install_skill_creates_skill_md_at_config_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_skill = tmp_path / "source" / "skill.md"
    source_skill.parent.mkdir()
    source_skill.write_text("# graphify\n", encoding="utf-8")
    monkeypatch.setenv("GRAPHIFY_SKILL_PATH", str(source_skill))
    monkeypatch.setattr(claude_runner.subprocess, "run", _raise_graphify_missing)

    skill_path = claude_runner.install_skill(tmp_path / ".claude")

    assert skill_path == tmp_path / ".claude" / "skills" / "graphify" / "SKILL.md"
    assert skill_path.read_text(encoding="utf-8") == "# graphify\n"


def test_install_skill_prefers_graphify_install_with_claude_config_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}
    config_dir = tmp_path / ".claude"

    def fake_run(args: list[str], **kwargs: Any) -> None:
        captured["args"] = args
        captured["kwargs"] = kwargs
        skill_path = config_dir / "skills" / "graphify" / "SKILL.md"
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text("# graphify cli\n", encoding="utf-8")

    monkeypatch.setattr(claude_runner.subprocess, "run", fake_run)

    skill_path = claude_runner.install_skill(config_dir)

    assert captured["args"] == ["graphify", "install"]
    assert captured["kwargs"]["env"]["CLAUDE_CONFIG_DIR"] == str(config_dir)
    assert skill_path.read_text(encoding="utf-8") == "# graphify cli\n"


def test_install_skill_uses_installed_package_with_shallow_module_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    package_root = tmp_path / "site-packages"
    graphify_pkg = package_root / "graphify"
    graphify_pkg.mkdir(parents=True)
    (graphify_pkg / "__init__.py").write_text("", encoding="utf-8")
    (graphify_pkg / "skill.md").write_text("# installed graphify\n", encoding="utf-8")

    monkeypatch.syspath_prepend(str(package_root))
    monkeypatch.delitem(sys.modules, "graphify", raising=False)
    monkeypatch.delenv("GRAPHIFY_SKILL_PATH", raising=False)
    monkeypatch.setattr(claude_runner, "__file__", "/app/src/claude_runner.py")
    monkeypatch.setattr(claude_runner.subprocess, "run", _raise_graphify_missing)

    skill_path = claude_runner.install_skill(tmp_path / ".claude")

    assert skill_path.read_text(encoding="utf-8") == "# installed graphify\n"


def test_spawn_claude_uses_required_stream_json_args(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        def __init__(self, args: list[str], **kwargs: Any) -> None:
            captured["args"] = args
            captured["kwargs"] = kwargs

    monkeypatch.setattr(claude_runner.subprocess, "Popen", FakePopen)

    claude_runner.spawn_claude(
        tmp_path / "session", tmp_path / ".claude", tmp_path / ".claude/settings.json"
    )

    args = captured["args"]
    assert args[:1] == ["claude"]
    assert "--bare" in args
    assert "-p" in args
    assert _arg_value(args, "--input-format") == "stream-json"
    assert _arg_value(args, "--output-format") == "stream-json"
    assert _arg_value(args, "--permission-mode") == "bypassPermissions"
    assert captured["kwargs"]["stdin"] is claude_runner.subprocess.PIPE
    assert captured["kwargs"]["stdout"] is claude_runner.subprocess.PIPE
    assert captured["kwargs"]["stderr"] is claude_runner.subprocess.DEVNULL
    assert captured["kwargs"]["cwd"] == str(tmp_path / "session")


def test_write_user_message_outputs_stream_json_user_line() -> None:
    proc = FakeProc()

    claude_runner.write_user_message(proc, "hello")

    payload = json.loads(proc.stdin.getvalue())
    assert payload == {
        "type": "user",
        "message": {"role": "user", "content": "hello"},
    }


def test_parse_stream_event_parses_system() -> None:
    event = claude_runner.parse_stream_event(
        '{"type":"system","session_id":"session-1"}'
    )

    assert event == {
        "type": "system",
        "session_id": "session-1",
        "raw": {"type": "system", "session_id": "session-1"},
    }


def test_parse_stream_event_parses_assistant_text_and_tool_use() -> None:
    line = json.dumps(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Working"},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}},
                ],
            },
        }
    )

    event = claude_runner.parse_stream_event(line)

    assert event is not None
    assert event["type"] == "assistant"
    assert event["text"] == "Working"
    assert event["tool_uses"][0]["name"] == "Bash"


def test_parse_stream_event_parses_result_success() -> None:
    event = claude_runner.parse_stream_event(
        '{"type":"result","result":{"is_error":false}}'
    )

    assert event is not None
    assert event["type"] == "result"
    assert event["is_error"] is False


def test_parse_stream_event_parses_result_error() -> None:
    event = claude_runner.parse_stream_event(
        '{"type":"result","result":{"is_error":true,"error":"bad"}}'
    )

    assert event is not None
    assert event["type"] == "result"
    assert event["is_error"] is True
    assert event["message"] == "bad"


def test_parse_stream_event_parses_error_event() -> None:
    event = claude_runner.parse_stream_event(
        '{"type":"error","error":{"message":"boom"}}'
    )

    assert event is not None
    assert event["type"] == "error"
    assert event["message"] == "boom"
    assert claude_runner.parse_stream_event("not json") is None


def test_idle_with_complete_output_succeeds_and_terminates(tmp_path: Path) -> None:
    proc = FakeProc()
    output_dir = tmp_path / "graphify-out"
    output_dir.mkdir()
    (output_dir / "graph.json").write_text('{"nodes":[],"links":[]}', encoding="utf-8")
    wiki_dir = output_dir / "wiki"
    wiki_dir.mkdir()
    (wiki_dir / "index.md").write_text("# Index\n", encoding="utf-8")

    result = claude_runner.resolve_idle_state(
        tmp_path, assistant_waiting_for_input=False, proc=proc
    )

    assert result["state"] == "SUCCEEDED"
    assert result["status"] == "success"
    assert result["graph_json_path"] == str(output_dir / "graph.json")
    assert proc.terminated is True


def test_output_complete_requires_wiki_markdown(tmp_path: Path) -> None:
    output_dir = tmp_path / "graphify-out"
    output_dir.mkdir()
    (output_dir / "graph.json").write_text('{"nodes":[],"links":[]}', encoding="utf-8")

    assert claude_runner.output_complete(tmp_path) is False


def test_idle_with_missing_output_and_waiting_fails_requires_interaction(
    tmp_path: Path,
) -> None:
    proc = FakeProc()

    result = claude_runner.resolve_idle_state(
        tmp_path, assistant_waiting_for_input=True, proc=proc
    )

    assert result["state"] == "FAILED"
    assert result["reason"] == "requires_interaction"
    assert result["retryable"] is False
    assert proc.terminated is True


def test_timeout_sends_sigterm_after_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    input_dir = _input_dir(tmp_path)
    fake_proc = FakeProc(stdout=BlockingStdout())
    _enable_runner(monkeypatch, tmp_path)

    def fake_popen(*_args: Any, **_kwargs: Any) -> FakeProc:
        return fake_proc

    monkeypatch.setattr(claude_runner.subprocess, "Popen", fake_popen)

    result = asyncio.run(claude_runner.run_graphify("run-1", input_dir, timeout=0.01))

    assert result["reason"] == "timeout"
    assert fake_proc.terminated is True
    assert fake_proc.killed is False


def test_preflight_151_files_fails_input_too_large(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GRAPHIFY_MAX_INPUT_FILES", raising=False)
    monkeypatch.delenv("GRAPHIFY_MAX_INPUT_WORDS", raising=False)
    for index in range(151):
        (tmp_path / f"{index}.md").write_text("word", encoding="utf-8")

    result = claude_runner.preflight_check(tmp_path)

    assert result["reason"] == "input_too_large"
    assert result["file_count"] == 151


def test_preflight_1500001_words_fails_input_too_large(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GRAPHIFY_MAX_INPUT_FILES", raising=False)
    monkeypatch.delenv("GRAPHIFY_MAX_INPUT_WORDS", raising=False)
    (tmp_path / "large.md").write_text("w " * 1_500_001, encoding="utf-8")

    result = claude_runner.preflight_check(tmp_path)

    assert result["reason"] == "input_too_large"
    assert result["total_words"] == 1_500_001


def test_preflight_within_limits_returns_ok(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_text("one two", encoding="utf-8")
    (tmp_path / "b.md").write_text("three", encoding="utf-8")

    result = claude_runner.preflight_check(tmp_path)

    assert result == {"ok": True, "file_count": 2, "total_words": 3}


def test_preflight_rejects_symlinked_input_files(tmp_path: Path) -> None:
    target = tmp_path / "outside.md"
    target.write_text("secret", encoding="utf-8")
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    try:
        (input_dir / "linked.md").symlink_to(target)
    except OSError as exc:
        pytest.skip(f"symlinks unavailable: {exc}")

    result = claude_runner.preflight_check(input_dir)

    assert result["ok"] is False
    assert result["reason"] == "input_symlink_rejected"
    assert result["path"] == str(input_dir / "linked.md")


def test_prepare_run_dirs_clears_existing_session_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(claude_runner, "GRAPHIFY_RUN_ROOT", tmp_path / "work")
    monkeypatch.delenv("GRAPHIFY_RUN_ROOT", raising=False)
    stale_file = tmp_path / "work" / "run-1" / "session" / "graphify-out" / "graph.json"
    stale_file.parent.mkdir(parents=True)
    stale_file.write_text("stale", encoding="utf-8")

    dirs = claude_runner.prepare_run_dirs("run-1")

    assert dirs.session_dir == tmp_path / "work" / "run-1" / "session"
    assert not stale_file.exists()
    assert dirs.input_dir.is_dir()
    assert dirs.config_dir.is_dir()


def test_run_graphify_within_preflight_limits_proceeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    input_dir = _input_dir(tmp_path)
    fake_proc = FakeProc(
        stdout=LineStdout(
            [
                '{"type":"system","session_id":"session-1"}\n',
                '{"type":"result","result":{"is_error":false}}\n',
            ]
        )
    )
    spawned: list[Path] = []
    _enable_runner(monkeypatch, tmp_path)

    def fake_spawn(
        session_dir: Path, _config_dir: Path, _settings_path: Path
    ) -> FakeProc:
        spawned.append(session_dir)
        output_dir = session_dir / "graphify-out"
        output_dir.mkdir()
        (output_dir / "graph.json").write_text(
            '{"nodes":[],"links":[]}', encoding="utf-8"
        )
        wiki_dir = output_dir / "wiki"
        wiki_dir.mkdir()
        (wiki_dir / "index.md").write_text("# Index\n", encoding="utf-8")
        return fake_proc

    monkeypatch.setattr(claude_runner, "spawn_claude", fake_spawn)

    result = asyncio.run(claude_runner.run_graphify("run-1", input_dir, timeout=1))

    assert result["status"] == "success"
    assert result["session_id"] == "session-1"
    assert spawned == [tmp_path / "work" / "run-1" / "session"]
    assert "/graphify ./input --wiki" in fake_proc.stdin.getvalue()


def test_runner_disabled_returns_immediate_retryable_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "disabled")

    def fail_spawn(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("disabled runner must not spawn Claude")

    monkeypatch.setattr(claude_runner, "spawn_claude", fail_spawn)

    result = asyncio.run(claude_runner.run_graphify("run-1", tmp_path))

    assert result["reason"] == "runner_disabled"
    assert result["retryable"] is True
    assert result["status"] == "failed"
    assert result["state"] == "FAILED"


def test_missing_api_key_returns_immediate_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "claude_code")
    monkeypatch.delenv("AGENT_ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AGENT_ANTHROPIC_BASE_URL", "https://agent.test")

    def fail_spawn(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("missing API key must not spawn Claude")

    monkeypatch.setattr(claude_runner, "spawn_claude", fail_spawn)

    result = asyncio.run(claude_runner.run_graphify("run-1", tmp_path))

    assert result["reason"] == "missing_api_key"
    assert result["status"] == "failed"
    assert result["state"] == "FAILED"


def test_subagent_tool_name_is_agent() -> None:
    assert claude_runner.SUBAGENT_TOOL_NAME == "Agent"


def test_settings_and_spawn_tool_lists_are_consistent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    class FakePopen:
        def __init__(self, args: list[str], **kwargs: Any) -> None:
            captured["args"] = args
            captured["kwargs"] = kwargs

    monkeypatch.setattr(claude_runner.subprocess, "Popen", FakePopen)
    settings_path = claude_runner.generate_settings(tmp_path / ".claude")
    settings = json.loads(settings_path.read_text(encoding="utf-8"))

    claude_runner.spawn_claude(
        tmp_path / "session", tmp_path / ".claude", settings_path
    )

    spawn_tools = _arg_value(captured["args"], "--tools").split(",")
    assert settings["permissions"]["allow"] == spawn_tools
    assert settings["allowedTools"] == spawn_tools
    assert spawn_tools == claude_runner.ALLOWED_TOOLS


def _arg_value(args: list[str], name: str) -> str:
    index = args.index(name)
    return args[index + 1]


def _raise_graphify_missing(*_args: Any, **_kwargs: Any) -> None:
    raise FileNotFoundError("graphify")


def _input_dir(tmp_path: Path) -> Path:
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    (input_dir / "doc.md").write_text("hello world", encoding="utf-8")
    return input_dir


def _enable_runner(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GRAPHIFY_RUNNER_MODE", "claude_code")
    monkeypatch.setenv("AGENT_ANTHROPIC_API_KEY", "agent-key")
    monkeypatch.setenv("AGENT_ANTHROPIC_BASE_URL", "https://agent.test")
    monkeypatch.setattr(claude_runner, "GRAPHIFY_RUN_ROOT", tmp_path / "work")
    monkeypatch.delenv("GRAPHIFY_RUN_ROOT", raising=False)

    def fake_install_skill(config_dir: Path | str) -> Path:
        skill_path = Path(config_dir) / "skills" / "graphify" / "SKILL.md"
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text("# graphify\n", encoding="utf-8")
        return skill_path

    monkeypatch.setattr(claude_runner, "install_skill", fake_install_skill)


class LineStdout:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def readline(self) -> str:
        if not self._lines:
            return ""
        return self._lines.pop(0)


class BlockingStdout:
    def readline(self) -> str:
        time.sleep(0.2)
        return ""


class FakeProc:
    def __init__(self, stdout: Any | None = None) -> None:
        self.stdin = InspectableStringIO()
        self.stdout = stdout or LineStdout([])
        self.stderr = io.StringIO()
        self.terminated = False
        self.killed = False

    def poll(self) -> int | None:
        return 0 if self.terminated or self.killed else None

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True

    def wait(self) -> int:
        return 0


class InspectableStringIO(io.StringIO):
    def close(self) -> None:
        pass
