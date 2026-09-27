"""End-to-end tests that drive the real Streamlit app with a fake OpenRouter.

No network access is needed, and no real money is spent.
"""

import json
import os
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

import config
import council_logic as logic
import openrouter_client as orc

APP = str(Path(__file__).resolve().parent.parent / "app.py")
MEMBERS = config.MEMBERS

CATALOGUE = [
    {
        "id": m.default_model,
        "name": m.default_model,
        "created": i,
        "pricing": {"prompt": "0.000002", "completion": "0.00001"},
    }
    for i, m in enumerate(MEMBERS)
] + [{"id": "openai/gpt-5.5", "name": "GPT-5.5", "created": 99, "pricing": {"prompt": "0.000002", "completion": "0.00001"}}]


class FakeCouncil:
    """Stands in for orc.chat_completion. `votes[(member_key, round)]` sets each answer."""

    def __init__(self, votes):
        self.votes = dict(votes)
        self.calls = []
        self.fail = set()  # (member_key, round) pairs that raise an API error

    def __call__(self, api_key, model, messages, max_tokens, timeout=180):
        system, user = messages[0]["content"], messages[1]["content"]
        member = next(m for m in MEMBERS if f"You are {m.name}," in system)
        round_no = 2 if "ROUND 2: FINAL VOTE" in user else 1
        self.calls.append({"member": member.key, "round": round_no, "model": model, "user": user, "key": api_key})
        if (member.key, round_no) in self.fail:
            raise orc.OpenRouterError("Rate limited (429): too many requests right now.")
        vote = self.votes[(member.key, round_no)]
        tag = f"MARKER-{member.key}-R{round_no}"
        if round_no == 1:
            answer = {
                "vote": vote,
                "reasoning": f"{tag} reasoning costs $5",
                "strongest_objection": f"{tag} objection",
                "missing_fact": f"{tag} missing fact",
            }
        else:
            answer = {
                "response_to_others": f"{tag} response",
                "final_vote": vote,
                "final_reasoning": f"{tag} final reasoning",
                "vote_change_explanation": f"{tag} change",
            }
        return {
            "text": json.dumps(answer),
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 1000, "completion_tokens": 400, "cost": 0.01},
            "served_model": model,
        }

    def calls_for(self, round_no):
        return [c for c in self.calls if c["round"] == round_no]


def votes(r1, r2):
    keys = [m.key for m in MEMBERS]
    return {**{(k, 1): v for k, v in zip(keys, r1)}, **{(k, 2): v for k, v in zip(keys, r2)}}


@pytest.fixture
def council(monkeypatch):
    monkeypatch.setattr(orc, "fetch_models", lambda timeout=15: CATALOGUE)
    fake = FakeCouncil(votes(["YES", "NO", "YES"], ["YES", "NO", "YES"]))
    monkeypatch.setattr(orc, "chat_completion", fake)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-v1-test")
    return fake


def start():
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    assert not at.exception, [e.value for e in at.exception]
    return at


def fill_example(at):
    at.button(key="fill_example").click().run()
    return at


def texts(at, kind):
    return [e.value for e in getattr(at, kind)]


def page_text(at):
    parts = []
    for kind in ("markdown", "info", "warning", "error", "success", "caption", "header", "subheader"):
        parts += [str(v) for v in texts(at, kind)]
    return "\n".join(parts)


def submit_round1(at, consent=True):
    if consent:
        at.checkbox(key="consent").check()
    at.button(key="run_round1").click().run()
    assert not at.exception, [e.value for e in at.exception]
    return at


def run_round2(at):
    at.button(key="run_round2").click().run()
    assert not at.exception, [e.value for e in at.exception]
    return at


# --- nothing is sent without an explicit, valid submission -----------------


def test_first_load_sends_nothing(council):
    at = start()
    assert council.calls == []
    assert "Step 1 · Describe your decision" in texts(at, "header")
    assert any("API key found" in s for s in texts(at.sidebar, "success"))


def test_filling_the_form_sends_nothing(council):
    at = fill_example(start())
    at.checkbox(key="consent").check().run()
    assert council.calls == []
    assert at.text_input(key="case_motion").value == logic.EXAMPLE_CASE["motion"]


def test_consent_box_is_required(council):
    at = submit_round1(fill_example(start()), consent=False)
    assert council.calls == []
    assert any("Nothing was sent" in e and "Tick the box" in e for e in texts(at, "error"))


def test_incomplete_inputs_are_explained(council):
    at = start()
    at.text_input(key="case_motion").input("Should I adopt a dog?").run()
    at = submit_round1(at)
    assert council.calls == []
    error = texts(at, "error")[0]
    assert "Nothing was sent" in error
    for label in ("Known facts", "Unknown or disputed facts", "Alternative actions", "Who may be affected"):
        assert label in error


def test_badly_worded_motion_is_flagged(council):
    at = fill_example(start())
    at.text_input(key="case_motion").input("Adopt a dog").run()
    assert any("Should I" in w for w in texts(at, "warning"))
    at = submit_round1(at)
    assert council.calls == []


def test_missing_api_key(council, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    at = submit_round1(fill_example(start()))
    assert council.calls == []
    assert any("No OpenRouter API key found" in e for e in texts(at.sidebar, "error"))
    assert any("Nothing was sent" in e and "No OpenRouter API key" in e for e in texts(at, "error"))


def test_api_key_from_secrets_file(council, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    at = AppTest.from_file(APP, default_timeout=30)
    at.secrets["OPENROUTER_API_KEY"] = "sk-or-v1-from-secrets"
    at.run()
    assert any("secrets.toml" in s for s in texts(at.sidebar, "success"))
    submit_round1(fill_example(at))
    assert {c["key"] for c in council.calls} == {"sk-or-v1-from-secrets"}


def test_placeholder_key_is_rejected(council, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-v1-your-key-here")
    at = submit_round1(fill_example(start()))
    assert council.calls == []
    assert any("placeholder" in e for e in texts(at.sidebar, "error"))


def test_invalid_model_id_is_caught_before_sending(council):
    at = fill_example(start())
    at.text_input(key="model_melchior").input("openai/gpt-9-imaginary").run()
    assert any("not in the OpenRouter catalogue" in e for e in texts(at.sidebar, "error"))
    at = submit_round1(at)
    assert council.calls == []
    assert any("gpt-9-imaginary" in e for e in texts(at, "error"))
    # Clicking a suggestion fixes it.
    at.button(key="use_melchior_openai/gpt-5.5").click().run()
    assert at.text_input(key="model_melchior").value == "openai/gpt-5.5"
    submit_round1(at)
    assert {c["model"] for c in council.calls if c["member"] == "melchior"} == {"openai/gpt-5.5"}


def test_catalogue_unavailable(council, monkeypatch):
    def offline(timeout=15):
        raise orc.OpenRouterError("Could not reach OpenRouter to load the model catalogue.")

    monkeypatch.setattr(orc, "fetch_models", offline)
    at = submit_round1(fill_example(start()))
    assert council.calls == []
    assert any("Could not reach OpenRouter" in e for e in texts(at.sidebar, "error"))
    assert any("catalogue has not loaded" in e for e in texts(at, "error"))


# --- the two rounds -------------------------------------------------------


def test_full_deliberation_with_majority_and_dissent(council):
    at = submit_round1(fill_example(start()))

    # Round 1: three independent calls; nobody sees anyone else's answer.
    r1 = council.calls_for(1)
    assert sorted(c["member"] for c in r1) == sorted(m.key for m in MEMBERS)
    assert len({c["user"] for c in r1}) == 1, "every member gets the same case"
    assert all("MARKER" not in c["user"] for c in r1)
    assert council.calls_for(2) == [], "round 2 must wait for its own click"
    assert "Step 3 · Round 2: deliberation and final votes" in texts(at, "header")
    assert at.text_input(key="case_motion").disabled, "the case is locked once submitted"

    at = run_round2(at)
    r2 = council.calls_for(2)
    assert len(r2) == 3
    for call in r2:
        for m in MEMBERS:  # sees every Round 1 answer, including the other two
            assert f"MARKER-{m.key}-R1 reasoning" in call["user"]
        assert "-R2" not in call["user"], "members never see each other's Round 2 answers"

    text = page_text(at)
    assert "Majority advice: YES" in text
    assert "YES 2 · NO 1 · ABSTAIN 0" in text
    assert "Dissenting reasoning" in texts(at, "subheader")
    assert "MARKER-balthasar-R2 final reasoning" in text  # the dissenter's reasoning is shown
    assert "No member changed their vote." in text
    assert r"costs \$5" in text, "dollar signs are escaped so they don't render as maths"
    assert at.get("download_button")


def test_vote_change_is_reported(council):
    council.votes = votes(["NO", "NO", "YES"], ["NO", "YES", "YES"])
    at = run_round2(submit_round1(fill_example(start())))
    text = page_text(at)
    assert "Majority advice: YES" in text
    assert "Balthasar-2: Changed NO → YES" in text
    assert "Initial (Round 1) tally, for comparison: YES 1 · NO 2 · ABSTAIN 0" in text


def test_abstention_alongside_a_majority_is_labelled_separately(council):
    council.votes = votes(["YES", "NO", "YES"], ["YES", "ABSTAIN", "YES"])
    at = run_round2(submit_round1(fill_example(start())))
    text = page_text(at)
    assert "Majority advice: YES" in text
    assert "YES 2 · NO 0 · ABSTAIN 1" in text
    assert "No member voted against the majority (YES)." in text
    assert "Abstentions" in text and "MARKER-balthasar-R2 final reasoning" in text


@pytest.mark.parametrize(
    "final, tally",
    [
        (["YES", "NO", "ABSTAIN"], "YES 1 · NO 1 · ABSTAIN 1"),
        (["YES", "ABSTAIN", "ABSTAIN"], "YES 1 · NO 0 · ABSTAIN 2"),
        (["ABSTAIN", "ABSTAIN", "ABSTAIN"], "YES 0 · NO 0 · ABSTAIN 3"),
    ],
)
def test_no_verdict(council, final, tally):
    council.votes = votes(["YES", "NO", "ABSTAIN"], final)
    at = run_round2(submit_round1(fill_example(start())))
    text = page_text(at)
    assert "NO VERDICT" in text
    assert tally in text
    assert "Majority advice" not in text
    assert "Each member's final position" in texts(at, "subheader")


def test_failed_member_can_be_retried_alone(council):
    council.fail = {("casper", 1)}
    at = submit_round1(fill_example(start()))
    assert any("Rate limited" in e for e in texts(at, "error"))
    assert "Step 3 · Round 2: deliberation and final votes" not in texts(at, "header")

    council.fail = set()
    at.button(key="retry_round1").click().run()
    r1 = council.calls_for(1)
    assert [c["member"] for c in r1].count("casper") == 2
    assert [c["member"] for c in r1].count("melchior") == 1, "members that succeeded are not re-run"
    assert "Step 3 · Round 2: deliberation and final votes" in texts(at, "header")


def test_unclear_vote_is_not_counted(council):
    council.votes[("melchior", 1)] = "Probably yes"
    at = submit_round1(fill_example(start()))
    assert any("did not contain a valid vote" in e for e in texts(at, "error"))
    assert "Step 3 · Round 2: deliberation and final votes" not in texts(at, "header")


def test_start_over_keeps_case_but_clears_votes(council):
    at = run_round2(submit_round1(fill_example(start())))
    at.button(key="start_over").click().run()
    assert at.session_state["deliberation"] is None
    assert at.text_input(key="case_motion").value == logic.EXAMPLE_CASE["motion"]
    assert not at.text_input(key="case_motion").disabled
    assert not at.checkbox(key="consent").value, "consent is asked for again for each new submission"


def test_costs_are_shown(council):
    at = start()
    assert any("Estimated maximum cost" in i for i in texts(at, "info"))
    at = run_round2(submit_round1(fill_example(at)))
    assert any("reported by OpenRouter" in c for c in texts(at, "caption"))
    spent = at.sidebar.metric[0]
    assert spent.value == "$0.060"  # six calls at $0.01


def test_nothing_is_written_to_disk(council, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    run_round2(submit_round1(fill_example(start())))
    assert list(tmp_path.iterdir()) == []
    assert not os.path.exists(Path(APP).parent / "decision-council-report.md")
