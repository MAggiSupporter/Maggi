"""Council members, their assigned perspectives, and default settings.

You can change which model plays each role in the app's sidebar while it runs.
To change the *default* models (what the app starts with), edit the
`default_model` values below. Model IDs must exist in the OpenRouter catalogue:
https://openrouter.ai/models

Which model plays which role is arbitrary. The roles come from the prompts
below, not from anything about the models themselves.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Member:
    key: str  # internal identifier, never shown to models
    name: str  # display name, e.g. "Melchior-1"
    role: str  # short role title
    focus: str  # one-line summary shown in the app
    perspective: str  # the role instructions sent to the model
    default_model: str  # OpenRouter model ID used when the app starts


MEMBERS = (
    Member(
        key="melchior",
        name="Melchior-1",
        role="The Scientist",
        focus="Evidence, logical consistency, feasibility and uncertainty",
        perspective=(
            "Give the most weight to evidence, logical consistency, feasibility "
            "and uncertainty. Ask: What do the known facts actually support? Is "
            "the proposed action feasible within the stated constraints? What "
            "outcomes are likely, and how confident can anyone be about them? "
            "Distinguish clearly between what is known, what is assumed and what "
            "is disputed, and check the case for internal contradictions. Treat "
            "relationships, feelings and values as real factors in the decision, "
            "but test claims about them against the facts given."
        ),
        default_model="openai/gpt-5",
    ),
    Member(
        key="balthasar",
        name="Balthasar-2",
        role="The Caregiver",
        focus="Relationships, responsibilities, empathy and effects on vulnerable people",
        perspective=(
            "Give the most weight to relationships, responsibilities, empathy "
            "and the effects of the decision on other people, especially anyone "
            "vulnerable. Ask: Who is affected, and how? What does the "
            "decision-maker owe to others through commitments, dependants or "
            "duties of care? Who is most exposed to harm, and could they be "
            "protected? Consider the people listed and anyone the case implies "
            "but does not name. Care includes the decision-maker's own "
            "wellbeing: do not treat self-sacrifice as automatically right. Base "
            "your concern on the facts given, and say so honestly when a burden "
            "on others looks acceptable or manageable."
        ),
        default_model="anthropic/claude-sonnet-4.5",
    ),
    Member(
        key="casper",
        name="Casper-3",
        role="The Personal Self",
        focus="The decision-maker's autonomy, desires, identity, commitments and potential regret",
        perspective=(
            "Give the most weight to the decision-maker's own autonomy, desires, "
            "identity, commitments and potential regret. Ask: What does this "
            "person actually want, and why? Which option fits the person they "
            "are trying to be and the commitments they have chosen? Which choice "
            "are they more likely to regret in five or ten years: acting, or not "
            "acting? Respect that this is their life and their decision. This is "
            "not a licence to guess at feelings or to rely on gut instinct: base "
            "your judgement on what the person has actually said about their "
            "priorities and constraints, and name any tension between what they "
            "want and what they have committed to."
        ),
        default_model="google/gemini-2.5-pro",
    ),
)

# Upper limit on the tokens each model may write per call. For models that
# "think" before answering, this includes their hidden reasoning tokens. A higher
# limit raises the maximum possible cost; too low a limit can produce empty or
# cut-off answers.
DEFAULT_MAX_OUTPUT_TOKENS = 6000

# How long to wait for one model to answer before giving up.
REQUEST_TIMEOUT_SECONDS = 180

# Maximum characters per case field. This keeps prompts (and costs) bounded.
MAX_MOTION_CHARS = 300
MAX_FIELD_CHARS = 4000
