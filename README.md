# Decision Council

A small web app that runs on your own laptop. Three AI "council members" vote YES, NO or
ABSTAIN on a question about **your own** decision. They vote first independently, then
again after reading each other's reasoning. The structure is inspired by the MAGI system in
*Neon Genesis Evangelion*.

| Member | Assigned perspective | Default model |
|---|---|---|
| **Melchior-1** · The Scientist | Evidence, logical consistency, feasibility, uncertainty | `openai/gpt-5` |
| **Balthasar-2** · The Caregiver | Relationships, responsibilities, empathy, effects on vulnerable people | `anthropic/claude-sonnet-4.5` |
| **Casper-3** · The Personal Self | Your autonomy, desires, identity, commitments, potential regret | `google/gemini-2.5-pro` |

The perspectives come from the instructions each model receives. No model is inherently more
logical, caring or intuitive, and which model plays which role is arbitrary. You can change it
in the app.

> **Advice, not an answer.** A majority vote is not proof of truth or moral correctness, and AI
> models can be confidently wrong. The app never takes any action on your behalf.

---

## What you need

1. **Python 3.10 or newer.** To check, open a terminal (see below) and run
   `python3 --version` on macOS/Linux or `py --version` on Windows.
   If you don't have it, install it from <https://www.python.org/downloads/>. On Windows,
   tick **“Add python.exe to PATH”** in the installer.
2. **An OpenRouter account with a little credit.** OpenRouter (<https://openrouter.ai>) gives
   you access to models from OpenAI, Anthropic, Google and others with one API key. A few
   dollars of credit is plenty for testing.
3. **This project folder on your laptop** (step 1 below).

**How to open a terminal in a folder**
- **macOS:** open the *Terminal* app, type `cd ` (with a space), drag the folder onto the
  Terminal window, then press Enter.
- **Windows:** open the folder in File Explorer, click the address bar, type `powershell`, then
  press Enter.

---

## Step 1: Get the code

With git:

```bash
git clone https://github.com/MAggiSupporter/Maggi.git
cd Maggi
git checkout claude/decision-council-app-os549i
```

(If this branch has already been merged, skip the `git checkout` line.)

Without git: on the GitHub page for the repository, choose the branch
`claude/decision-council-app-os549i`, click **Code → Download ZIP**, unzip it, and open a
terminal in the unzipped folder.

## Step 2: Install (one time only)

These commands create a private Python environment in a `.venv` folder, so nothing is
installed system-wide.

**macOS / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

**Windows (PowerShell)**

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

When the environment is active, your terminal prompt starts with `(.venv)`.
If PowerShell says *“running scripts is disabled on this system”*, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, then run the
`Activate.ps1` line again.

## Step 3: Add your OpenRouter API key

1. Create a key at <https://openrouter.ai/settings/keys> and copy it. It starts with `sk-or-`.
   While there, you can set a **credit limit** on the key as a safety net.
2. Add credit at <https://openrouter.ai/settings/credits>.
3. Create your private secrets file by copying the example:
   - macOS / Linux: `cp .streamlit/secrets.toml.example .streamlit/secrets.toml`
   - Windows: `copy .streamlit\secrets.toml.example .streamlit\secrets.toml`
4. Open the new file in a text editor:
   - macOS: `open -e .streamlit/secrets.toml`
   - Windows: `notepad .streamlit\secrets.toml`
5. Replace `sk-or-v1-your-key-here` with your key. **Keep the quotes.** Save and close. The
   line should look like:

   ```toml
   OPENROUTER_API_KEY = "sk-or-v1-abc123..."
   ```

`.streamlit/secrets.toml` is listed in `.gitignore`, so git will not commit it. Never paste
your key into `app.py` or any other file. To double-check, run `git status`:
`secrets.toml` should **not** appear in the list.

*Alternative:* set an environment variable instead of using the file. It only lasts for the
current terminal window. (If both are set, the secrets file is used.)
- macOS / Linux: `export OPENROUTER_API_KEY="sk-or-v1-abc123..."`
- Windows PowerShell: `$env:OPENROUTER_API_KEY="sk-or-v1-abc123..."`

## Step 4: Run the app

```bash
python -m streamlit run app.py
```

Your browser should open <http://localhost:8501>. If it doesn't, open that address yourself.
To stop the app, click the terminal window and press **Ctrl+C**.

**Next time:** open a terminal in the folder, activate the environment
(`source .venv/bin/activate` on macOS/Linux or `.venv\Scripts\Activate.ps1` on Windows), then
run the command above.

## Step 5: Try it with the fictional example

1. **Check the sidebar.** The API key box should be green, and each model should show a ✅ with
   its price. If a model shows a red *“not in the OpenRouter catalogue”* message, click one
   of the suggested IDs underneath it. OpenRouter's catalogue changes over time, so a default
   ID may have been retired.
2. Click **“Fill in a fictional example”**. This fills in the made-up case shown below and sends
   nothing.
3. Read the **estimated maximum cost** and tick the box confirming you understand where your
   case is sent. Then click **“Submit case and run Round 1”** and wait (up to a minute or
   two). Please don't click anything while it runs.
4. You should see three cards. Each has an **initial vote**, its **reasoning**, the **strongest
   objection to its own vote**, the **missing fact most likely to change its vote**, and the
   cost of the call.
5. Click **“Run Round 2”**. Each card now shows a **final vote** marked *Kept* or *Changed*,
   plus the member's response to the others' strongest points.
6. **Step 4 · Result** shows the majority advice (or **NO VERDICT**), the final tally, a table
   of initial and final votes, the dissenting reasoning, and the facts that could change the
   outcome. You can download a Markdown report.
7. The sidebar's **“Spending this session”** shows the total. Compare it with
   <https://openrouter.ai/activity>, which is the authoritative record.

Things to try next:
- **Check validation:** click “Start over”, clear one box, and try to submit. The app lists
  what's missing and sends nothing.
- **Swap models between roles** (for example, put the Gemini model on Melchior-1) and run the
  same case again. If the votes follow the model rather than the role, that's worth knowing.
- **Run the same case twice.** AI answers vary, and a split vote on a rerun tells you
  something too.

<details>
<summary>The fictional example case</summary>

**Motion:** Should I accept the two-year research job in Lisbon that starts in March?

**Known facts:** Two-year fixed-term contract at a marine research institute; pay about 20%
higher after living costs; current job in Leeds is permanent but repetitive; father (72) lives
20 minutes away with mild mobility problems; sister lives three hours from him; partner can
work remotely abroad for up to six months a year; must reply within three weeks.

**Unknown or disputed facts:** Whether the current employer would rehire later; how much help
the father will need (doctor: "probably stable", sister: getting worse); whether the partner's
remote work could extend beyond six months.

**Alternative actions:** Decline; ask to delay the start six months; ask for a one-year
contract; look for a similar job closer to home.

**Priorities and constraints:** Wanted marine research for ten years and this is the first
offer; promised the sister to share caregiving; savings for about four months without income;
doesn't want to be apart from the partner for more than a few months.

**Who may be affected:** Father, sister, partner, current team, the decision-maker.
</details>

---

## How the voting works

1. **Round 1: independent.** Each member receives the same case and only its own role, and
   votes without seeing any other member's answer. The three calls run at the same time.
2. **Round 2: final vote.** Each member sees its own Round 1 answer and the other two
   members' Round 1 answers. It responds to their strongest points and casts a final vote. It
   is told it may keep or change its vote, and that agreement is not a goal in itself. It is
   never asked to reach consensus. Members never see each other's Round 2 answers.
3. **Result.** YES or NO needs **at least 2 of the 3** final votes. Otherwise the result is
   **NO VERDICT**. An abstention always counts as an abstention and is never turned into YES
   or NO. If a model's answer doesn't contain a clear YES, NO or ABSTAIN, the app does not
   guess: it shows an error and lets you retry that member.

Each round runs only when you click its button. If one member fails (for example, the
provider is busy), you can retry just that member.

## Changing models and roles

- **During a session:** edit the model IDs in the sidebar. They're checked against
  OpenRouter's live catalogue. The **“Browse the OpenRouter model catalogue”** section at the
  bottom of the page lists every model with prices. Models are locked while a deliberation is
  open; click “Start over” to change them.
- **Defaults:** edit `default_model` in `config.py`.
- **Role instructions:** edit `perspective` in `config.py`. The rules shared by all members
  and the round instructions are in `council_logic.py`.

## Privacy

- **Nothing you type leaves your laptop until you click a “Run” button.** When the app starts,
  it downloads OpenRouter's public model list. That request contains none of your case text.
- When you click “Run”, your case is sent to **OpenRouter** and to the companies running the
  three models (e.g. OpenAI, Anthropic, Google). Their data policies apply. Review your
  settings at <https://openrouter.ai/settings/privacy>, and leave out names and details you
  don't need.
- **The app saves no history.** Your case and results exist only in your browser tab and are
  gone when you refresh or close it. The optional “Download report” button is the only way to
  keep a copy. `.gitignore` excludes `decision-council-report*.md` in case you save one here.
- The app only listens on your own computer (`localhost`), and Streamlit's anonymous usage
  statistics are turned off (see `.streamlit/config.toml`).

## Costs

- **Every model call may cost money**, charged to your OpenRouter credit. Each round makes 3
  calls, so a full deliberation makes 6 (plus any retries).
- Before each round, the app shows an **upper-bound estimate** from OpenRouter's catalogue
  prices. It assumes every model writes its full output allowance, so real costs are usually
  much lower.
- After each call, the app shows the cost OpenRouter reported, and the sidebar keeps a
  running total for the session.
- To limit the worst case, lower **“Max output tokens per call”** in the sidebar, choose
  cheaper models, or set a credit limit on your API key.

## Troubleshooting

| What you see | What to do |
|---|---|
| *No OpenRouter API key found* | Do step 3, then stop the app (Ctrl+C) and start it again. Make sure you ran the app from the project folder. |
| *…still contains the example placeholder* | Replace `sk-or-v1-your-key-here` in `.streamlit/secrets.toml` with your real key. |
| *…secrets.toml file could not be read* | The file must contain exactly one line like `OPENROUTER_API_KEY = "sk-or-..."`, with quotes. |
| *OpenRouter rejected your API key (401)* | Copy the key again from openrouter.ai/settings/keys. Check it wasn't deleted. |
| *…not have enough credit (402)* | Add credit, or lower “Max output tokens per call”. |
| *“…” is not in the OpenRouter catalogue* | Click a suggested ID in the sidebar, or find one at <https://openrouter.ai/models>. |
| *Could not reach OpenRouter…* | Check your internet connection, then click “Reload model catalogue”. |
| *…used all of its output tokens…* | The model spent its allowance on hidden reasoning. Raise “Max output tokens per call” and click Retry. |
| *…not in the required JSON format* / *…did not contain a valid vote* | Click Retry. If it keeps happening, use a different model. |
| *Rate limited (429)* or *down or overloaded (502/503)* | Wait a minute and click Retry, or choose a different model. |
| `No module named streamlit` or `streamlit: command not found` | Activate the environment first (step 2), then run `python -m streamlit run app.py`. |
| *Port 8501 is already in use* | Another copy is running. Close it, or run `python -m streamlit run app.py --server.port 8502`. |

## Automated tests

The tests use a fake OpenRouter, so they need no API key, no internet and no money:

```bash
python -m pytest
```

They cover every possible combination of votes, the NO VERDICT rule, abstentions never becoming
YES or NO, round independence (Round 1 prompts contain no other member's answer; Round 2 prompts
contain only Round 1 answers), nothing being sent before the button click or with invalid
inputs, missing and placeholder keys, unknown model IDs, API errors, retries, cost display, and
the app writing no files.

## Project files

| File | What it is |
|---|---|
| `app.py` | The Streamlit web page |
| `council_logic.py` | Prompts, answer parsing, vote counting, cost estimates, report |
| `openrouter_client.py` | Talks to OpenRouter and turns errors into plain messages |
| `config.py` | The three roles, default models and limits |
| `.streamlit/config.toml` | Local-only server, no usage statistics, no Deploy button |
| `.streamlit/secrets.toml.example` | Template for your API key file |
| `tests/` | Automated tests |

## Limitations

- The default model IDs were chosen when this was written. OpenRouter retires models, so the
  app checks every ID against the live catalogue and suggests replacements.
- Cost figures are estimates or OpenRouter-reported values. Your OpenRouter activity page is
  the authoritative record.
- AI models can misread a case, invent details, or answer differently each time. Treat the
  council as a structured way to surface arguments and missing facts, not as an authority.
