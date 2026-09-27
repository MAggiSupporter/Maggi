"""Decision Council: a local Streamlit app.

Start it from this folder with:
    python -m streamlit run app.py
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import streamlit as st

import config
import council_logic as logic
import openrouter_client as orc

st.set_page_config(page_title="Decision Council", page_icon="⚖️", layout="wide")

MEMBERS = config.MEMBERS
MEMBER_BY_KEY = {m.key: m for m in MEMBERS}
ALL_KEYS = [m.key for m in MEMBERS]
PLACEHOLDER_KEY_MARKER = "your-key-here"
RESTART_TO_ADD_KEY = (
    "To add your key: close the black window (Windows) or Terminal window (Mac) that "
    "is running this app, start the app again the same way you did before, and paste "
    "your key when it asks. See README.md, step 4."
)
# Where Streamlit looks for secrets: the folder you run from, and this app's folder.
SECRETS_FILES = (
    Path(".streamlit/secrets.toml"),
    Path(__file__).resolve().parent / ".streamlit" / "secrets.toml",
)

VOTE_BADGES = {
    "YES": ":green-background[**YES**]",
    "NO": ":red-background[**NO**]",
    "ABSTAIN": ":gray-background[**ABSTAIN**]",
}


# ---------------------------------------------------------------------------
# State and small helpers
# ---------------------------------------------------------------------------


def init_state() -> None:
    """Everything lives in this browser tab's memory only. Nothing is saved."""
    ss = st.session_state
    ss.setdefault("deliberation", None)  # the submitted case, models and results
    ss.setdefault("call_log", [])  # one entry per billed model call, for cost display
    ss.setdefault("catalogue", None)  # {model_id: model_info} from OpenRouter
    ss.setdefault("catalogue_error", None)
    ss.setdefault("max_tokens", config.DEFAULT_MAX_OUTPUT_TOKENS)
    ss.setdefault("consent", False)
    for m in MEMBERS:
        ss.setdefault(f"model_{m.key}", m.default_model)
    for f in logic.CASE_FIELDS:
        ss.setdefault(f"case_{f.key}", "")


def md(text: str) -> str:
    """Stop Streamlit from treating $ signs as maths formatting."""
    return text.replace("$", r"\$")


def current_case() -> dict:
    return {f.key: st.session_state[f"case_{f.key}"] or "" for f in logic.CASE_FIELDS}


def current_models() -> dict:
    return {m.key: (st.session_state[f"model_{m.key}"] or "").strip() for m in MEMBERS}


def get_api_key() -> tuple[str | None, str]:
    """Return (key, where it was found) or (None, what to do about it)."""
    # Check the secrets file first. Streamlit also copies its values into
    # environment variables, so checking those first would mislabel the source.
    unreadable = (
        "Your saved key file (.streamlit/secrets.toml) could not be read. "
        + RESTART_TO_ADD_KEY
    )
    try:
        key = str(st.secrets.get("OPENROUTER_API_KEY", "")).strip()
        source = "your .streamlit/secrets.toml file"
    except FileNotFoundError:
        # Streamlit raises this both when there is no file and when the file
        # isn't valid TOML, so check whether a file is actually there.
        if any(p.exists() for p in SECRETS_FILES):
            return None, unreadable
        key = ""
    except Exception:
        return None, unreadable
    if not key:
        key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        source = "the OPENROUTER_API_KEY environment variable"
    if not key:
        return None, "No OpenRouter API key found. " + RESTART_TO_ADD_KEY
    if PLACEHOLDER_KEY_MARKER in key:
        return None, (
            "Your saved key file still contains the example placeholder, not a real key. "
            + RESTART_TO_ADD_KEY
        )
    return key, source


def ensure_catalogue() -> None:
    """Load OpenRouter's public model list once per session.

    This sends no case data and costs nothing."""
    ss = st.session_state
    if ss.catalogue is None and ss.catalogue_error is None:
        with st.spinner("Loading the OpenRouter model catalogue…"):
            try:
                ss.catalogue = {m["id"]: m for m in orc.fetch_models()}
            except orc.OpenRouterError as exc:
                ss.catalogue_error = str(exc)


# ---------------------------------------------------------------------------
# Button callbacks
# ---------------------------------------------------------------------------


def reload_catalogue() -> None:
    st.session_state.catalogue = None
    st.session_state.catalogue_error = None


def fill_example() -> None:
    for key, value in logic.EXAMPLE_CASE.items():
        st.session_state[f"case_{key}"] = value


def clear_case() -> None:
    for f in logic.CASE_FIELDS:
        st.session_state[f"case_{f.key}"] = ""


def use_model(member_key: str, model_id: str) -> None:
    st.session_state[f"model_{member_key}"] = model_id


def apply_preset() -> None:
    models = config.PRESETS.get(st.session_state.preset)
    if models:  # "Custom" leaves the typed IDs alone
        for key, model_id in models.items():
            st.session_state[f"model_{key}"] = model_id


def matching_preset(models: dict) -> str:
    for name, preset in config.PRESETS.items():
        if preset == models:
            return name
    return config.CUSTOM_PRESET


def start_over() -> None:
    st.session_state.deliberation = None


# ---------------------------------------------------------------------------
# Running a round
# ---------------------------------------------------------------------------


def round_messages(round_no: int, member: config.Member, delib: dict) -> list[dict]:
    if round_no == 1:
        return logic.build_round1_messages(member, delib["case"])
    round1 = {key: record["parsed"] for key, record in delib["round1"].items()}
    return logic.build_round2_messages(member, delib["case"], round1, MEMBERS)


def consult_member(
    round_no: int,
    member: config.Member,
    api_key: str,
    model: str,
    model_info: dict,
    messages: list[dict],
    max_tokens: int,
    results: dict,
    call_log: list,
) -> dict:
    """One paid model call. Runs in a worker thread, so no st.* calls here."""
    record = {
        "model": model,
        "ok": False,
        "parsed": None,
        "error": None,
        "warnings": [],
        "raw": None,
        "usage": None,
        "cost": None,
        "cost_is_estimate": False,
    }
    usage = None
    try:
        reply = orc.chat_completion(
            api_key,
            model,
            messages,
            logic.effective_max_tokens(model_info, max_tokens),
            timeout=config.REQUEST_TIMEOUT_SECONDS,
        )
    except orc.OpenRouterError as exc:
        record["error"] = str(exc)
        usage = exc.usage
    except Exception as exc:  # unexpected: show it instead of crashing the app
        record["error"] = f"Unexpected error: {type(exc).__name__}: {exc}"
    else:
        usage = reply["usage"]
        record["raw"] = reply["text"]
        parsed = logic.parse_round1(reply["text"]) if round_no == 1 else logic.parse_round2(reply["text"])
        record.update(
            ok=parsed["ok"], parsed=parsed["parsed"], error=parsed["error"], warnings=parsed["warnings"]
        )
        if reply["finish_reason"] == "length":
            record["warnings"].append(
                "This answer hit the output-token limit and may be cut off. "
                "You can raise “Max output tokens per call” in the sidebar."
            )
    if usage is not None:  # the call reached a model, so it may have been billed
        cost, estimated = logic.cost_from_usage(usage, model_info)
        record.update(usage=usage, cost=cost, cost_is_estimate=estimated)
        call_log.append(
            {"round": round_no, "member": member.name, "model": model, "cost": cost, "estimated": estimated}
        )
    results[member.key] = record
    return record


def run_round(round_no: int, member_keys: list[str], api_key: str) -> None:
    """Ask the given members in parallel. Each one only sees its own prompt."""
    delib = st.session_state.deliberation
    results = delib[f"round{round_no}"]
    call_log = st.session_state.call_log
    max_tokens = int(st.session_state.max_tokens)
    label = f"Round {round_no}: consulting {len(member_keys)} council member(s)… This can take a minute or two. Please don't click anything."
    with st.status(label, expanded=True) as status:
        with ThreadPoolExecutor(max_workers=len(member_keys)) as pool:
            futures = {}
            for key in member_keys:
                member = MEMBER_BY_KEY[key]
                results.pop(key, None)
                future = pool.submit(
                    consult_member,
                    round_no,
                    member,
                    api_key,
                    delib["models"][key],
                    delib["model_info"][key],
                    round_messages(round_no, member, delib),
                    max_tokens,
                    results,
                    call_log,
                )
                futures[future] = member
            for future in as_completed(futures):
                record = future.result()
                member = futures[future]
                if record["ok"]:
                    status.write(f"✅ {member.name} answered.")
                else:
                    status.write(f"⚠️ {member.name} had a problem (details below).")
        failed = [k for k in member_keys if not results[k]["ok"]]
        status.update(
            label=f"Round {round_no}: done." if not failed else f"Round {round_no}: finished with problems.",
            state="complete" if not failed else "error",
            expanded=False,
        )


def show_estimate(messages_by_key: dict[str, list[dict]], model_infos: dict[str, dict | None]) -> None:
    max_tokens = int(st.session_state.max_tokens)
    total, unknown = 0.0, []
    for key, messages in messages_by_key.items():
        chars = sum(len(m["content"]) for m in messages)
        estimate = logic.estimate_max_call_cost(model_infos.get(key), chars, max_tokens)
        if estimate is None:
            unknown.append(MEMBER_BY_KEY[key].name)
        else:
            total += estimate
    n = len(messages_by_key)
    text = (
        f"💰 **Estimated maximum cost of {'this call' if n == 1 else f'these {n} calls'}: "
        f"about {logic.format_cost(total)}.** This is an upper bound that assumes each model "
        f"writes its full allowance of {max_tokens:,} output tokens. Real costs are usually "
        "much lower. Prices come from the OpenRouter catalogue."
    )
    if unknown:
        text += f" Pricing is unknown for {', '.join(unknown)}, so the real maximum may be higher."
    st.info(md(text))


# ---------------------------------------------------------------------------
# Page sections
# ---------------------------------------------------------------------------


def render_sidebar(api_key: str | None, key_status: str, locked: bool) -> None:
    ss = st.session_state
    with st.sidebar:
        st.header("Setup")

        st.subheader("API key")
        if api_key:
            st.success(f"OpenRouter API key found in {key_status}.")
        else:
            st.error(key_status)

        st.subheader("Council models")
        # Show which ready-made set the current models match (or "Custom").
        ss.preset = matching_preset(current_models())
        st.selectbox(
            "Model set",
            [*config.PRESETS, config.CUSTOM_PRESET],
            key="preset",
            on_change=apply_preset,
            disabled=locked,
            help="Pick a ready-made set of three models, one from each company. "
            "You can also type your own model IDs below.",
        )
        st.caption(config.PRESET_DESCRIPTIONS[ss.preset] + " The cost estimate is shown before each round.")
        catalogue = ss.catalogue
        if catalogue is not None:
            st.caption(f"Model IDs are checked against OpenRouter's live catalogue ({len(catalogue):,} models).")
        else:
            st.error(ss.catalogue_error or "The model catalogue has not loaded.")
        st.button("Reload model catalogue", on_click=reload_catalogue, key="reload_catalogue")
        if locked:
            st.caption("🔒 Models are locked while a deliberation is open. Click “Start over” to change them.")

        for m in MEMBERS:
            st.text_input(
                f"{m.name} · {m.role}",
                key=f"model_{m.key}",
                disabled=locked,
                help=f"Focus: {m.focus}. Enter an OpenRouter model ID such as openai/gpt-5. "
                "Find IDs at https://openrouter.ai/models or in the catalogue browser at the bottom of the page.",
            )
            model_id = current_models()[m.key]
            if not model_id:
                st.error("Enter a model ID.")
            elif catalogue is None:
                st.caption("This ID can't be checked until the catalogue loads.")
            elif model_id in catalogue:
                info = catalogue[model_id]
                st.caption(
                    md(
                        f"✅ {info.get('name') or model_id} · "
                        f"{logic.format_price_per_million(info, 'prompt')} input, "
                        f"{logic.format_price_per_million(info, 'completion')} output tokens"
                    )
                )
            else:
                st.error(f"“{model_id}” is not in the OpenRouter catalogue.")
                suggestions = logic.suggest_models(model_id, catalogue)
                if suggestions and not locked:
                    st.caption("Click to use one of these instead:")
                    for suggestion in suggestions:
                        st.button(
                            suggestion,
                            key=f"use_{m.key}_{suggestion}",
                            on_click=use_model,
                            args=(m.key, suggestion),
                        )

        providers = [logic.provider_of(mid) for mid in current_models().values() if mid]
        shared = sorted({p for p in providers if providers.count(p) > 1})
        if shared:
            st.warning(
                f"More than one member uses a model from “{', '.join(shared)}”. That works, "
                "but models from different families give more independent perspectives."
            )

        st.subheader("Advanced")
        st.number_input(
            "Max output tokens per call",
            min_value=500,
            max_value=32000,
            step=500,
            key="max_tokens",
            help="The most each model may write per call, including hidden 'reasoning' tokens "
            "for models that think before answering. Higher limits raise the maximum possible "
            "cost. If a member returns an empty or cut-off answer, raise this and retry.",
        )

        st.subheader("Spending this session")
        log = ss.call_log
        known = [c["cost"] for c in log if c["cost"] is not None]
        st.metric("Spent on model calls", logic.format_cost(sum(known)) if log else "$0.00")
        notes = [f"{len(log)} billed model call(s) so far."]
        if any(c["estimated"] and c["cost"] is not None for c in log):
            notes.append("Some figures are estimates from token counts.")
        if len(known) < len(log):
            notes.append(f"{len(log) - len(known)} call(s) had an unknown cost.")
        notes.append("Your authoritative record is at https://openrouter.ai/activity")
        st.caption(" ".join(notes))


def render_intro() -> None:
    st.title("⚖️ Decision Council")
    st.markdown(
        "Three AI council members, each assigned a different perspective, vote on a YES/NO "
        "question about **your own** decision: first independently, then after reading each "
        "other's reasoning. Inspired by the MAGI system in *Neon Genesis Evangelion*."
    )
    st.info(
        "**This is advice, not an answer.** A majority vote is not proof of truth or moral "
        "correctness, and AI models can be confidently wrong. The app never takes any action "
        "on your behalf. The decision is yours.",
        icon="ℹ️",
    )
    with st.expander("How it works · privacy · costs"):
        st.markdown(
            """
**The council**
- **Melchior-1 · The Scientist**: evidence, logical consistency, feasibility and uncertainty.
- **Balthasar-2 · The Caregiver**: relationships, responsibilities, empathy and effects on vulnerable people.
- **Casper-3 · The Personal Self**: your autonomy, desires, identity, commitments and potential regret.

These roles come from the instructions each model receives. No model is inherently more logical,
caring or intuitive, and every member is told to reason carefully. You can change which model plays
which role in the sidebar.

**The process**
1. **Round 1 (independent):** each member receives the same case and only its own role. No member sees
   another's answer. Each votes YES, NO or ABSTAIN and gives its reasoning, the strongest objection to
   its own vote, and the missing fact most likely to change its vote.
2. **Round 2 (final vote):** each member reads the other two members' Round 1 answers, responds to their
   strongest points and casts a final vote. It may change its mind, but it is not asked to agree.
3. **Result:** YES or NO needs at least 2 of the 3 final votes. Otherwise the result is **NO VERDICT**.
   Abstentions are never counted as YES or NO.

**Privacy**
- Nothing you type leaves your computer until you click a “Run” button. (Loading the model
  catalogue sends none of your case text.)
- When you click “Run”, your case is sent to OpenRouter and to the companies that run the three
  models. Their data policies apply, so check your privacy settings at https://openrouter.ai/settings/privacy.
  Leave out names and identifying details you don't need.
- The app saves nothing. Your case and results exist only in this browser tab and disappear when
  you refresh or close it, unless you click “Download report”.

**Costs**
- Every model call may cost money, charged to your OpenRouter credit. Each round makes 3 calls,
  so a full deliberation makes 6 (more if you retry).
- Before each round you'll see an estimated maximum cost. After each call you'll see the cost OpenRouter reported.
"""
        )


def render_case_form(locked: bool) -> None:
    st.header("Step 1 · Describe your decision")
    if locked:
        st.caption("🔒 The case is locked while this deliberation is open. Click “Start over” at the bottom of the page to edit it.")
    else:
        st.caption("Nothing is sent anywhere until you click “Submit case and run Round 1”.")
        c1, c2, _ = st.columns([1, 1, 3])
        c1.button("Fill in a fictional example", on_click=fill_example, key="fill_example")
        c2.button("Clear the form", on_click=clear_case, key="clear_case")

    motion = logic.CASE_FIELDS[0]
    st.text_input(
        motion.label,
        key="case_motion",
        placeholder=motion.placeholder,
        help=motion.help,
        max_chars=config.MAX_MOTION_CHARS,
        disabled=locked,
    )
    if not locked and (st.session_state.case_motion or "").strip():
        motion_errors, motion_warnings = logic.validate_motion(st.session_state.case_motion)
        for problem in motion_errors + motion_warnings:
            st.warning(problem)

    fields = logic.CASE_FIELDS[1:]
    for row_start in range(0, len(fields), 2):
        cols = st.columns(2)
        for col, field in zip(cols, fields[row_start : row_start + 2]):
            with col:
                st.text_area(
                    field.label,
                    key=f"case_{field.key}",
                    placeholder=field.placeholder,
                    help=field.help,
                    max_chars=config.MAX_FIELD_CHARS,
                    height=160,
                    disabled=locked,
                )


def round1_problems(api_key: str | None, key_status: str) -> list[str]:
    """Everything that must be fixed before any data is sent."""
    problems = []
    if not api_key:
        problems.append(key_status)
    errors, _ = logic.validate_case(current_case())
    problems += errors
    catalogue = st.session_state.catalogue
    if catalogue is None:
        problems.append(
            "The model catalogue has not loaded, so the model IDs can't be checked. "
            + (st.session_state.catalogue_error or "")
        )
    for m in MEMBERS:
        model_id = current_models()[m.key]
        if not model_id:
            problems.append(f"Enter a model ID for {m.name} in the sidebar.")
        elif catalogue is not None and model_id not in catalogue:
            problems.append(
                f"{m.name}'s model “{model_id}” is not in the OpenRouter catalogue. "
                "Click one of the suggestions in the sidebar, or find a valid ID at https://openrouter.ai/models"
            )
    if not st.session_state.consent:
        problems.append("Tick the box confirming you understand where your case is sent and that calls may cost money.")
    return problems


def cost_caption(record: dict) -> str:
    if record["usage"] is None:
        return "No usage reported: the request failed before a model answered."
    usage = record["usage"]
    tokens = ""
    if isinstance(usage.get("prompt_tokens"), int) and isinstance(usage.get("completion_tokens"), int):
        tokens = f" · {usage['prompt_tokens']:,} input / {usage['completion_tokens']:,} output tokens"
    if record["cost"] is None:
        return f"Cost: unknown{tokens}"
    source = "estimated from token counts" if record["cost_is_estimate"] else "reported by OpenRouter"
    return md(f"Cost: {logic.format_cost(record['cost'])} ({source}){tokens}")


def render_member_card(member: config.Member, round_no: int, record: dict | None, delib: dict) -> None:
    with st.container(border=True):
        st.markdown(f"#### {member.name}")
        st.caption(f"{member.role} · `{delib['models'][member.key]}`")
        if record is None:
            st.caption("Not run yet.")
            return
        if not record["ok"]:
            st.error(record["error"])
            if record["raw"]:
                with st.expander("Show the member's raw answer"):
                    st.text(record["raw"])
        else:
            p = record["parsed"]
            if round_no == 1:
                st.markdown(f"**Initial vote:** {VOTE_BADGES[p['vote']]}")
                sections = [
                    ("Reasoning", p["reasoning"]),
                    ("Strongest objection to its own vote", p["strongest_objection"]),
                    ("Missing fact most likely to change its vote", p["missing_fact"]),
                ]
            else:
                initial = delib["round1"][member.key]["parsed"]["vote"]
                final = p["final_vote"]
                st.markdown(f"**Final vote:** {VOTE_BADGES[final]} · {logic.describe_change(initial, final)}")
                sections = [
                    ("Response to the other members", p["response_to_others"]),
                    ("Final reasoning", p["final_reasoning"]),
                    ("Why it changed or kept its vote", p["vote_change_explanation"]),
                ]
            for title, body in sections:
                st.markdown(f"**{title}**")
                st.markdown(md(body))
        for warning in record["warnings"]:
            st.warning(warning)
        st.caption(cost_caption(record))


def render_round_results(round_no: int, delib: dict) -> None:
    results = delib[f"round{round_no}"]
    for col, m in zip(st.columns(len(MEMBERS)), MEMBERS):
        with col:
            render_member_card(m, round_no, results.get(m.key), delib)


def render_retry(round_no: int, delib: dict, api_key: str | None, key_status: str) -> bool:
    """Offer to re-run only the members whose answer failed. Returns True if any failed."""
    results = delib[f"round{round_no}"]
    failed = [k for k in ALL_KEYS if not results.get(k, {}).get("ok")]
    if not failed:
        return False
    names = ", ".join(MEMBER_BY_KEY[k].name for k in failed)
    next_step = "Round 2" if round_no == 1 else "The result"
    keep = "" if len(failed) == len(ALL_KEYS) else "; the others keep their answers"
    st.warning(
        f"{next_step} needs a valid answer from all three members. Retry re-runs only "
        f"{names}{keep}. To use a different model instead, click “Start over” (your case "
        "text is kept), change the model in the sidebar and run again."
    )
    show_estimate(
        {k: round_messages(round_no, MEMBER_BY_KEY[k], delib) for k in failed},
        delib["model_info"],
    )
    if st.button(f"Retry {names} (paid)", key=f"retry_round{round_no}"):
        if not api_key:
            st.error(key_status)
        else:
            run_round(round_no, failed, api_key)
            st.rerun()
    return True


def render_round1(api_key: str | None, key_status: str) -> None:
    st.header("Step 2 · Round 1: independent votes")
    delib = st.session_state.deliberation
    if delib is None:
        st.markdown(
            "When you click the button, your case is sent **once to each of the three models** "
            "through OpenRouter. In this round no member sees another member's answer."
        )
        catalogue = st.session_state.catalogue
        if catalogue is not None:
            case = current_case()
            show_estimate(
                {m.key: logic.build_round1_messages(m, case) for m in MEMBERS},
                {k: catalogue.get(v) for k, v in current_models().items()},
            )
        st.checkbox(
            "I understand that clicking the button sends my case text to OpenRouter and the three "
            "model providers, and that each model call may cost money.",
            key="consent",
        )
        if st.button("Submit case and run Round 1 (3 paid model calls)", type="primary", key="run_round1"):
            problems = round1_problems(api_key, key_status)
            if problems:
                st.error(
                    "**Nothing was sent.** Please fix the following first:\n\n"
                    + "\n".join(f"- {md(p)}" for p in problems)
                )
            else:
                models = current_models()
                st.session_state.deliberation = {
                    "case": {k: v.strip() for k, v in current_case().items()},
                    "models": models,
                    "model_info": {k: catalogue[v] for k, v in models.items()},
                    "round1": {},
                    "round2": {},
                }
                run_round(1, ALL_KEYS, api_key)
                st.rerun()
        return

    render_round_results(1, delib)
    render_retry(1, delib, api_key, key_status)


def render_round2(api_key: str | None, key_status: str) -> None:
    delib = st.session_state.deliberation
    if delib is None or not all(delib["round1"].get(k, {}).get("ok") for k in ALL_KEYS):
        return
    st.header("Step 3 · Round 2: deliberation and final votes")
    if not delib["round2"]:
        st.markdown(
            "Each member now reads the other two members' Round 1 answers, responds to their "
            "strongest points and casts a final vote. Members may change their minds, but none is "
            "asked to agree. Members do not see each other's Round 2 answers."
        )
        show_estimate(
            {m.key: round_messages(2, m, delib) for m in MEMBERS},
            delib["model_info"],
        )
        if st.button("Run Round 2 (3 paid model calls)", type="primary", key="run_round2"):
            if not api_key:
                st.error(key_status)
            else:
                run_round(2, ALL_KEYS, api_key)
                st.rerun()
        return

    render_round_results(2, delib)
    render_retry(2, delib, api_key, key_status)


def render_verdict() -> None:
    delib = st.session_state.deliberation
    if delib is None or not all(delib["round2"].get(k, {}).get("ok") for k in ALL_KEYS):
        return

    st.header("Step 4 · Result")
    initial = {k: delib["round1"][k]["parsed"]["vote"] for k in ALL_KEYS}
    final = {k: delib["round2"][k]["parsed"]["final_vote"] for k in ALL_KEYS}
    result = logic.tally_votes(final)
    before = logic.tally_votes(initial)

    def tally_text(t: logic.Tally) -> str:
        return " · ".join(f"{v} {t.counts[v]}" for v in logic.VALID_VOTES)

    st.markdown(md(f"**Motion:** {delib['case']['motion']}"))
    if result.verdict == logic.NO_VERDICT:
        st.warning(
            f"### NO VERDICT\n**Final tally: {tally_text(result)}**\n\n"
            "Neither YES nor NO received at least two final votes, so the council gives no majority "
            "advice. The disagreement or uncertainty is itself useful: see the facts below that "
            "could change the outcome."
        )
    else:
        action = "taking" if result.verdict == "YES" else "not taking"
        st.info(
            f"### Majority advice: {result.verdict}\n**Final tally: {tally_text(result)}**\n\n"
            f"{result.counts[result.verdict]} of {len(MEMBERS)} members advise {action} this action. "
            "This is advice, not proof: weigh the dissent below as seriously as the majority."
        )
    st.caption(f"Initial (Round 1) tally, for comparison: {tally_text(before)}")

    rows = [
        "| Member | Role | Model | Initial vote | Final vote | Change |",
        "|---|---|---|---|---|---|",
    ]
    for m in MEMBERS:
        rows.append(
            f"| {m.name} | {m.role} | `{delib['models'][m.key]}` | {VOTE_BADGES[initial[m.key]]} "
            f"| {VOTE_BADGES[final[m.key]]} | {logic.describe_change(initial[m.key], final[m.key])} |"
        )
    st.markdown("\n".join(rows))

    changes = [
        f"{m.name}: {logic.describe_change(initial[m.key], final[m.key])}"
        for m in MEMBERS
        if initial[m.key] != final[m.key]
    ]
    st.markdown("**Vote changes:** " + ("; ".join(changes) + "." if changes else "No member changed their vote."))

    def position_card(key: str) -> None:
        m, p = MEMBER_BY_KEY[key], delib["round2"][key]["parsed"]
        label = "Abstained" if p["final_vote"] == "ABSTAIN" else f"Voted {p['final_vote']}"
        with st.container(border=True):
            st.markdown(f"**{m.name} · {m.role}**: {label}")
            st.markdown(md(p["final_reasoning"]))

    dissenters, abstainers = logic.split_minority(final, result.verdict)
    if result.verdict == logic.NO_VERDICT:
        st.subheader("Each member's final position")
        for key in ALL_KEYS:
            position_card(key)
    else:
        st.subheader("Dissenting reasoning")
        if not dissenters:
            st.markdown(f"No member voted against the majority ({result.verdict}).")
        for key in dissenters:
            position_card(key)
        if abstainers:
            st.markdown("**Abstentions** (counted as abstentions, never as YES or NO):")
            for key in abstainers:
                position_card(key)

    st.subheader("Facts that could change the outcome")
    st.caption("Each member's answer (from Round 1) to “what missing fact is most likely to change your vote?”")
    for m in MEMBERS:
        st.markdown(md(f"- **{m.name}:** {delib['round1'][m.key]['parsed']['missing_fact']}"))

    st.info(
        "A majority vote is advice, not proof of truth or moral correctness. The app has not taken, "
        "and will not take, any action. What you do next is up to you.",
        icon="ℹ️",
    )
    st.download_button(
        "Download report (Markdown)",
        data=logic.build_report(delib, MEMBERS),
        file_name="decision-council-report.md",
        mime="text/markdown",
        key="download_report",
        help="Saves a copy to your computer. The app itself keeps nothing.",
    )


def render_catalogue_browser() -> None:
    catalogue = st.session_state.catalogue
    if not catalogue:
        return
    with st.expander("🔎 Browse the OpenRouter model catalogue"):
        query = st.text_input("Filter by ID or name (e.g. claude, gemini, gpt)", key="catalogue_filter")
        query = (query or "").strip().lower()
        rows = []
        for model_id, info in sorted(catalogue.items()):
            name = info.get("name") or ""
            if query and query not in model_id.lower() and query not in name.lower():
                continue
            p_in = logic.price_per_token(info, "prompt")
            p_out = logic.price_per_token(info, "completion")
            rows.append(
                {
                    "Model ID": model_id,
                    "Name": name,
                    "Input $/M tokens": round(p_in * 1_000_000, 3) if p_in is not None else None,
                    "Output $/M tokens": round(p_out * 1_000_000, 3) if p_out is not None else None,
                    "Context (tokens)": info.get("context_length"),
                }
            )
        st.caption(f"{len(rows):,} model(s). Copy a Model ID into the sidebar to use it.")
        st.dataframe(rows, hide_index=True)


def main() -> None:
    init_state()
    ensure_catalogue()
    api_key, key_status = get_api_key()
    locked = st.session_state.deliberation is not None

    render_sidebar(api_key, key_status, locked)
    render_intro()
    render_case_form(locked)
    render_round1(api_key, key_status)
    render_round2(api_key, key_status)
    render_verdict()
    if locked:
        st.divider()
        st.button(
            "Start over (keeps your case text, clears the votes)",
            on_click=start_over,
            key="start_over",
        )
    render_catalogue_browser()


main()
