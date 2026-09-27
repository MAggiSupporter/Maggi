import pytest

import launch

GOOD_KEY = "sk-or-v1-0123456789abcdef"


@pytest.fixture
def secrets(tmp_path, monkeypatch):
    path = tmp_path / ".streamlit" / "secrets.toml"
    monkeypatch.setattr(launch, "SECRETS_FILE", path)
    return path


def answers(*replies):
    """A fake input() that returns each reply in turn."""
    replies = list(replies)
    return lambda prompt="": replies.pop(0)


def test_saved_key_round_trip(secrets):
    launch.save_key(GOOD_KEY)
    assert launch.read_saved_key() == GOOD_KEY
    assert f'OPENROUTER_API_KEY = "{GOOD_KEY}"' in secrets.read_text()


@pytest.mark.parametrize(
    "content",
    [
        None,  # no file
        'OPENROUTER_API_KEY = "sk-or-v1-your-key-here"\n',  # untouched example
        "OPENROUTER_API_KEY = sk-or-v1-no-quotes\n",  # broken file
        'OPENROUTER_API_KEY = ""\n',
    ],
)
def test_unusable_saved_keys(secrets, content):
    if content is not None:
        secrets.parent.mkdir(parents=True)
        secrets.write_text(content)
    assert launch.read_saved_key() is None


def test_example_file_matches_what_the_launcher_treats_as_placeholder():
    example = launch.HERE / ".streamlit" / "secrets.toml.example"
    assert launch.read_saved_key(example) is None


@pytest.mark.parametrize(
    "pasted, expected",
    [
        (f"  {GOOD_KEY}  ", GOOD_KEY),
        (f'"{GOOD_KEY}"', GOOD_KEY),
        (f"'{GOOD_KEY}'\n", GOOD_KEY),
    ],
)
def test_clean_key(pasted, expected):
    assert launch.clean_key(pasted) == expected


@pytest.mark.parametrize("bad", ["", "hello", "sk-proj-openai-key", "sk-or-v1 abc def"])
def test_key_problem(bad):
    assert launch.key_problem(bad)


def test_key_problem_accepts_real_looking_key():
    assert launch.key_problem(GOOD_KEY) is None


def test_first_run_asks_until_a_valid_key_is_pasted(secrets, capsys):
    launch.ask_for_key(answers("", "not-a-key", f" {GOOD_KEY} "))
    assert launch.read_saved_key() == GOOD_KEY
    out = capsys.readouterr().out
    assert "Nothing was pasted" in out and "doesn't look like an OpenRouter key" in out


def test_enter_keeps_saved_key(secrets):
    launch.save_key(GOOD_KEY)
    launch.ask_for_key(answers(""))
    assert launch.read_saved_key() == GOOD_KEY


def test_pasting_replaces_saved_key(secrets):
    launch.save_key(GOOD_KEY)
    launch.ask_for_key(answers("sk-or-v1-newkey9999"))
    assert launch.read_saved_key() == "sk-or-v1-newkey9999"


def test_broken_key_file_is_replaced(secrets):
    secrets.parent.mkdir(parents=True)
    secrets.write_text("OPENROUTER_API_KEY = sk-or-v1-no-quotes\n")
    launch.ask_for_key(answers(GOOD_KEY))
    assert launch.read_saved_key() == GOOD_KEY


def test_no_input_available_and_no_saved_key_exits_cleanly(secrets):
    def closed(prompt=""):
        raise EOFError

    with pytest.raises(SystemExit):
        launch.ask_for_key(closed)


def test_windows_arm_install_failure_gives_specific_advice(monkeypatch, tmp_path):
    monkeypatch.setattr(launch, "VENV_DIR", tmp_path / ".venv")
    monkeypatch.setattr(launch, "_create_and_install", lambda: False)
    monkeypatch.setattr(launch.sysconfig, "get_platform", lambda: "win-arm64")
    with pytest.raises(SystemExit) as info:
        launch.install()
    assert "64-bit" in str(info.value)


def test_install_retries_once_from_scratch(monkeypatch, tmp_path):
    attempts = []
    monkeypatch.setattr(launch, "VENV_DIR", tmp_path / ".venv")
    monkeypatch.setattr(launch, "_create_and_install", lambda: attempts.append(1) or len(attempts) == 2)
    monkeypatch.setattr(launch.sysconfig, "get_platform", lambda: "macosx-14.0-arm64")
    launch.install()
    assert len(attempts) == 2
