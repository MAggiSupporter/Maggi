import itertools
import json

import pytest

import config
import council_logic as logic

MEMBERS = config.MEMBERS
M, B, C = MEMBERS


# --- inputs ---------------------------------------------------------------


@pytest.mark.parametrize(
    "motion",
    ["Should I move to Lisbon?", "should i take the job?", "  Should I adopt a dog ?  ", "Should I stay or not?"],
)
def test_valid_motions(motion):
    errors, warnings = logic.validate_motion(motion)
    assert errors == [] and warnings == []


@pytest.mark.parametrize(
    "motion",
    ["", "   ", "Move to Lisbon?", "Should I move to Lisbon", "Should we move?", "Should I?", "What should I do?"],
)
def test_invalid_motions(motion):
    errors, _ = logic.validate_motion(motion)
    assert errors


def test_motion_with_or_warns_but_does_not_block():
    errors, warnings = logic.validate_motion("Should I move to Lisbon or Porto?")
    assert errors == [] and warnings


def test_empty_case_lists_every_missing_field():
    errors, _ = logic.validate_case({})
    assert len(errors) == len(logic.CASE_FIELDS)


def test_example_case_is_valid():
    assert logic.validate_case(logic.EXAMPLE_CASE) == ([], [])


def test_overlong_field_is_rejected():
    case = dict(logic.EXAMPLE_CASE, known_facts="x" * (config.MAX_FIELD_CHARS + 1))
    errors, _ = logic.validate_case(case)
    assert any("too long" in e for e in errors)


# --- prompts --------------------------------------------------------------


def test_round1_every_member_gets_the_same_case_and_only_its_own_role():
    case = logic.EXAMPLE_CASE
    user_messages = set()
    for member in MEMBERS:
        system, user = logic.build_round1_messages(member, case)
        assert system["role"] == "system" and user["role"] == "user"
        assert member.name in system["content"]
        assert member.perspective in system["content"]
        for other in MEMBERS:
            if other is not member:
                assert other.name not in system["content"] + user["content"]
                assert other.perspective not in system["content"]
        assert case["motion"] in user["content"]
        user_messages.add(user["content"])
    assert len(user_messages) == 1, "all members must receive identical case information"


def _round1_answer(key):
    return {
        "vote": "YES",
        "reasoning": f"reasoning-{key}",
        "strongest_objection": f"objection-{key}",
        "missing_fact": f"fact-{key}",
    }


def test_round2_shows_other_members_round1_answers():
    round1 = {m.key: _round1_answer(m.key) for m in MEMBERS}
    for member in MEMBERS:
        _, user = logic.build_round2_messages(member, logic.EXAMPLE_CASE, round1, MEMBERS)
        text = user["content"]
        for m in MEMBERS:
            assert f"reasoning-{m.key}" in text
            assert f"objection-{m.key}" in text
        for other in MEMBERS:
            if other is not member:
                assert f"[{other.name}: {other.role}]" in text


def test_round2_does_not_ask_for_consensus():
    round1 = {m.key: _round1_answer(m.key) for m in MEMBERS}
    _, user = logic.build_round2_messages(M, logic.EXAMPLE_CASE, round1, MEMBERS)
    text = user["content"].lower()
    assert "consensus" not in text
    assert "you may keep your vote or change it" in text
    assert "agreement with the other members is not a goal" in text


def test_prompts_do_not_name_models_or_use_gender_stereotypes():
    round1 = {m.key: _round1_answer(m.key) for m in MEMBERS}
    for member in MEMBERS:
        text = " ".join(
            msg["content"]
            for msg in logic.build_round1_messages(member, logic.EXAMPLE_CASE)
            + logic.build_round2_messages(member, logic.EXAMPLE_CASE, round1, MEMBERS)
        ).lower()
        for word in ("gpt", "claude", "gemini", "openai", "anthropic", "google", "woman", "female", "feminine", "mother"):
            assert word not in text, f"{word!r} found in {member.name}'s prompt"
    assert "intuitive" not in C.perspective.lower()


def test_prompt_says_members_cannot_act():
    assert "cannot take any action" in logic.system_prompt(M)


# --- parsing --------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("YES", "YES"),
        ("no", "NO"),
        (" Abstain. ", "ABSTAIN"),
        ("**YES**", "YES"),
        ("maybe", None),
        ("lean yes", None),
        ("", None),
        (None, None),
        (1, None),
    ],
)
def test_normalize_vote_never_guesses(raw, expected):
    assert logic.normalize_vote(raw) == expected


def test_extract_json_handles_fences_and_preamble():
    obj = {"vote": "NO", "reasoning": "r"}
    assert logic.extract_json_object(json.dumps(obj)) == obj
    assert logic.extract_json_object("```json\n" + json.dumps(obj) + "\n```") == obj
    assert logic.extract_json_object("Here you go:\n" + json.dumps(obj) + "\nThanks") == obj
    assert logic.extract_json_object("no json here") is None
    assert logic.extract_json_object("{broken json") is None


def test_parse_round1_ok():
    result = logic.parse_round1(json.dumps(_round1_answer("m") | {"vote": "abstain"}))
    assert result["ok"] and result["parsed"]["vote"] == "ABSTAIN"


def test_parse_round1_rejects_unclear_vote():
    result = logic.parse_round1(json.dumps(_round1_answer("m") | {"vote": "Probably yes"}))
    assert not result["ok"] and "valid vote" in result["error"]


def test_parse_round1_missing_text_field_is_a_warning():
    answer = _round1_answer("m")
    del answer["missing_fact"]
    result = logic.parse_round1(json.dumps(answer))
    assert result["ok"] and result["warnings"]
    assert result["parsed"]["missing_fact"] == logic.NOT_PROVIDED


def test_parse_round2_reads_final_vote():
    result = logic.parse_round2(
        json.dumps(
            {
                "response_to_others": "a",
                "final_vote": "NO",
                "final_reasoning": "b",
                "vote_change_explanation": "c",
            }
        )
    )
    assert result["ok"] and result["parsed"]["final_vote"] == "NO"


# --- voting ---------------------------------------------------------------


@pytest.mark.parametrize("votes", list(itertools.product(logic.VALID_VOTES, repeat=3)))
def test_tally_every_possible_vote_combination(votes):
    result = logic.tally_votes(dict(zip("abc", votes)))
    yes, no, abstain = votes.count("YES"), votes.count("NO"), votes.count("ABSTAIN")
    assert result.counts == {"YES": yes, "NO": no, "ABSTAIN": abstain}
    if yes >= 2:
        assert result.verdict == "YES"
    elif no >= 2:
        assert result.verdict == "NO"
    else:
        assert result.verdict == logic.NO_VERDICT


def test_abstentions_are_never_converted():
    # One YES plus two abstentions is not a YES.
    assert logic.tally_votes({"a": "YES", "b": "ABSTAIN", "c": "ABSTAIN"}).verdict == logic.NO_VERDICT
    assert logic.tally_votes({"a": "YES", "b": "NO", "c": "ABSTAIN"}).verdict == logic.NO_VERDICT


def test_tally_rejects_invalid_votes():
    with pytest.raises(ValueError):
        logic.tally_votes({"a": "YES", "b": "YES", "c": None})


def test_split_minority():
    assert logic.split_minority({"a": "YES", "b": "NO", "c": "YES"}, "YES") == (["b"], [])
    assert logic.split_minority({"a": "YES", "b": "ABSTAIN", "c": "YES"}, "YES") == ([], ["b"])
    assert logic.split_minority({"a": "YES", "b": "NO", "c": "ABSTAIN"}, logic.NO_VERDICT) == ([], ["c"])


def test_describe_change():
    assert logic.describe_change("YES", "YES") == "Kept YES"
    assert logic.describe_change("NO", "ABSTAIN") == "Changed NO → ABSTAIN"


# --- models and costs -----------------------------------------------------

INFO = {
    "id": "openai/gpt-5",
    "pricing": {"prompt": "0.000001", "completion": "0.00001", "request": "0"},
    "top_provider": {"max_completion_tokens": 4000},
}


def test_estimate_max_call_cost_uses_capped_output_tokens():
    # 3000 chars ≈ 1000 tokens; output capped at the model's 4000-token limit.
    assert logic.estimate_max_call_cost(INFO, 3000, 10_000) == pytest.approx(0.001 + 0.04)


def test_estimate_unknown_pricing():
    assert logic.estimate_max_call_cost({"pricing": {"prompt": "-1", "completion": "-1"}}, 100, 100) is None
    assert logic.estimate_max_call_cost(None, 100, 100) is None


def test_cost_prefers_reported_cost():
    assert logic.cost_from_usage({"cost": 0.0123, "prompt_tokens": 1, "completion_tokens": 1}, INFO) == (0.0123, False)
    cost, estimated = logic.cost_from_usage({"prompt_tokens": 1000, "completion_tokens": 100}, INFO)
    assert estimated and cost == pytest.approx(0.001 + 0.001)
    assert logic.cost_from_usage({}, INFO) == (None, True)


def test_format_cost():
    assert logic.format_cost(None) == "unknown"
    assert logic.format_cost(0.00001) == "< $0.0001"
    assert logic.format_cost(0.0042) == "$0.0042"
    assert logic.format_cost(0.123) == "$0.123"


def test_suggest_models():
    catalogue = {
        "openai/gpt-5": {"id": "openai/gpt-5", "created": 1},
        "openai/gpt-5.5": {"id": "openai/gpt-5.5", "created": 3},
        "openai/gpt-5:free": {"id": "openai/gpt-5:free", "created": 4},
        "openai/image-model": {"id": "openai/image-model", "created": 5, "architecture": {"output_modalities": ["image"]}},
        "google/gemini-3-pro": {"id": "google/gemini-3-pro", "created": 2},
    }
    assert logic.suggest_models("gpt-5", catalogue)[0] == "openai/gpt-5"
    google = logic.suggest_models("google/gemini-1-ultra", catalogue)
    assert google == ["google/gemini-3-pro"]
    openai = logic.suggest_models("openai/gpt-9", catalogue)
    assert "openai/image-model" not in openai and "openai/gpt-5:free" not in openai
    assert openai[:2] == ["openai/gpt-5", "openai/gpt-5.5"]


def test_build_report():
    r1 = {m.key: {"parsed": _round1_answer(m.key)} for m in MEMBERS}
    r1["balthasar"]["parsed"]["vote"] = "NO"
    r2 = {
        m.key: {
            "parsed": {
                "response_to_others": "resp",
                "final_vote": "YES",
                "final_reasoning": "final",
                "vote_change_explanation": "why",
            }
        }
        for m in MEMBERS
    }
    delib = {
        "case": logic.EXAMPLE_CASE,
        "models": {m.key: m.default_model for m in MEMBERS},
        "round1": r1,
        "round2": r2,
    }
    report = logic.build_report(delib, MEMBERS)
    assert "## Result: YES" in report
    assert "Changed NO → YES" in report
    assert logic.EXAMPLE_CASE["motion"] in report
