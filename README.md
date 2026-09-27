# Decision Council

An app that runs on your own computer and opens in your web browser. You describe a decision
you're facing as a YES/NO question. Three AI "council members", each looking at it from a
different angle, vote YES, NO or ABSTAIN: first on their own, then again after reading each
other's reasoning. It's inspired by the MAGI system in *Neon Genesis Evangelion*.

> **Advice, not an answer.** A majority vote is not proof of truth or moral correctness, and AI
> can be confidently wrong. The app never does anything on your behalf; it only gives advice.

---

# Setup guide (no experience needed)

The first time takes about 15–20 minutes. After that, starting the app takes a few seconds.

You'll do five things:

1. **Install Python**: free software the app needs to run
2. **Get an OpenRouter key**: this lets the app use AI models (it costs a few cents per use)
3. **Download the app**
4. **Start the app**
5. **Try it** with a made-up example

Some steps are different on Windows and Mac. Not sure which you have? If your keyboard has a
**⌘ Command** key, it's a Mac.

---

## Step 1: Install Python

You only do this once.

### On Windows

1. Go to **<https://www.python.org/downloads/>**
2. Click the big yellow **Download Python** button. A file downloads.
3. Open the downloaded file. You can click it in your browser's download list, or find it in
   your **Downloads** folder.
4. **Important:** on the first screen of the installer, tick the box at the bottom that says
   **“Add python.exe to PATH”**.
5. Click **Install Now**. Wait until it finishes, then click **Close**.

*If the installer looks different from this, accept the options it suggests. Another option is
the **Microsoft Store** app: search for **Python 3.13** and click **Get**.*

### On a Mac

1. Go to **<https://www.python.org/downloads/>**
2. Click the big yellow **Download Python** button. A file ending in `.pkg` downloads.
3. Open it from your **Downloads** folder. Click **Continue**, **Agree** and **Install** through
   the screens, and enter your Mac password when asked.
4. When it says the installation was successful, click **Close**. If a Finder window called
   “Python 3.x” opens, you can close it.

---

## Step 2: Get an OpenRouter key

The app reaches the AI models through a service called **OpenRouter**. An **API key** is like
a password that lets the app use your OpenRouter account. Each time the council meets,
OpenRouter charges your account a small amount. Before anything runs, the app shows you the
most it could cost.

1. Go to **<https://openrouter.ai>** and click **Sign up** (top right). You can use a Google
   account or an email address.
2. **Add some credit.** Go to **<https://openrouter.ai/settings/credits>**, click
   **Add Credits** and add a small amount, for example $5. You'll need a payment card.
3. **Create a key.** Go to **<https://openrouter.ai/settings/keys>** and click the button to
   create a key. Name it anything, for example `Decision Council`. If it offers a
   **credit limit**, setting one (for example $2) is a good safety net.
4. **Copy the key.** It's a long code that starts with `sk-or-`. Keep that browser tab open
   until you've pasted the key in step 4, because OpenRouter may not show it again.
   Never share your key with anyone.

---

## Step 3: Download the app

1. Click this link to download the app as a zip file:
   **<https://github.com/MAggiSupporter/Maggi/archive/refs/heads/claude/decision-council-app-os549i.zip>**
2. Unzip it:
   - **Windows:** open your **Downloads** folder. **Right-click** the zip file, choose
     **Extract All…**, then click **Extract**. A new folder opens.
     ⚠️ Don't open the files while they're still inside the zip. Extract first, or the
     app won't start.
   - **Mac:** open your **Downloads** folder and double-click the zip file (some browsers
     unzip it automatically). A folder appears next to it.
3. Open the new folder, called `Maggi-claude-decision-council-app-os549i`. If there's another
   folder with the same name inside, open that one too. You should see files such as
   `app.py`, `start-windows` and `start-mac`.

You don't need to rename or move the folder.

---

## Step 4: Start the app

### On Windows

1. In the app folder, **double-click `start-windows`**. It may show as `start-windows.bat`,
   with a gear icon.
2. Windows may warn you because the file came from the internet:
   - If a blue box says **“Windows protected your PC”**, click **More info**, then **Run anyway**.
   - If it says **“The publisher could not be verified”**, click **Run**.
3. A black window opens and asks for your key. **Paste it** (press **Ctrl+V**, or right-click),
   then press **Enter**.
4. The first time, it installs what the app needs. This takes a few minutes and may look
   stuck. Just wait.
5. Your web browser opens the app. 🎉

### On a Mac

1. Open the **Terminal** app: press **⌘ Command + Space**, type `Terminal`, and press
   **Return**. A window for typing text commands opens.
2. In that window, type `bash` followed by **one space**. Don't press Return yet.
3. Drag the file **`start-mac`** (it may show as `start-mac.command`) from the app folder into
   the Terminal window. A long file location appears after `bash `.
4. Press **Return**.
5. If a box asks whether Terminal may access files in your **Downloads** folder, click
   **Allow**.
6. When it asks for your key, **paste it** (press **⌘ Command + V**), then press **Return**.
7. The first time, it installs what the app needs. This takes a few minutes and may look
   stuck. Just wait.
8. Your web browser opens the app. 🎉

### While you use the app

- **Keep the black window (Windows) or Terminal window (Mac) open.** It *is* the app. You can
  minimise it, but closing it stops the app.
- If your browser didn't open by itself, open it and go to **<http://localhost:8501>**.
  “localhost” means the app is running on your own computer, not on the internet.

---

## Step 5: Try it with the made-up example

1. **Check the left-hand panel ("Setup").** You should see a green box saying your API key
   was found, and a ✅ under each of the three models.
   If a model has a red box saying it's *“not in the OpenRouter catalogue”*, click one of
   the grey buttons under it to choose a replacement. AI models are retired from time to time.
2. In the main area, click **Fill in a fictional example**. This fills in a made-up decision
   about taking a job abroad. Nothing is sent anywhere yet.
3. Scroll down. Read the cost estimate, tick the box that starts **“I understand…”**, and
   click the red **Submit case and run Round 1** button. Wait up to a minute or two, and
   don't click anything while it works.
4. Three cards appear, one per council member, each with a first vote and its reasoning.
   Scroll down and click **Run Round 2**. Wait again.
5. Scroll down to **Step 4 · Result** to see the final advice, a table of votes, and any
   disagreement.

**“Spending this session”** in the left-hand panel shows what it cost.

**Now try your own decision:** scroll to the bottom and click **Start over**, then click
**Clear the form** near the top and fill in the six boxes. The first box must be a question
that starts with “Should I” and ends with “?”.

---

## Using the app again later

Repeat **Step 4**. It's quick after the first time. When it asks for your key, just press
**Enter** (Windows) or **Return** (Mac) to keep the saved one.

## Stopping the app

Close the black window (Windows) or the Terminal window (Mac). Closing only the browser tab
does **not** stop the app.

## Changing your key

Start the app as in Step 4. When it asks for your key, paste the new one instead of pressing
Enter/Return.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **“Python 3.10 or newer was not found”** | Do Step 1 again, then restart your computer and try Step 4 again. On Windows, if it still fails, install **Python 3.13** from the **Microsoft Store** app. |
| **Windows:** the black window flashes and disappears | Check that you extracted the zip (Step 3) and are double-clicking `start-windows` inside the extracted folder, not inside the zip. |
| **Mac:** `No such file or directory` | You probably pressed Return before dragging the file in. Try Step 4 again: type `bash ` (with the space), drag the file in, then press Return. |
| **Mac:** a box offers to install “command line developer tools” | Click **Cancel**. Install Python from python.org (Step 1), then try Step 4 again. |
| **“That doesn't look like an OpenRouter key”** | Copy the key again from OpenRouter. It starts with `sk-or-`. |
| **“Installing failed”** | Check that you're connected to the internet, then try Step 4 again. If the message mentions **ARM processors**, follow the instructions it gives (this affects some newer Windows laptops, such as Snapdragon ones). |
| In the app: **“No OpenRouter API key found”** | Close the black/Terminal window, do Step 4 again, and paste your key when asked. |
| In the app: **“OpenRouter rejected your API key (401)”** | Create a new key (Step 2), close the black/Terminal window, do Step 4 again, and paste the new key. |
| In the app: **“not have enough credit (402)”** | Add credit at <https://openrouter.ai/settings/credits>. |
| In the app: a model is **“not in the OpenRouter catalogue”** | In the left-hand panel, click one of the suggested replacements under it. |
| In the app: **“Could not reach OpenRouter”** | Check your internet connection, then click **Reload model catalogue** in the left-hand panel. |
| A council member shows **Rate limited (429)** or **down or overloaded** | Wait a minute, then click the **Retry** button under the cards. |
| A council member **“used all of its output tokens”** | In the left-hand panel, raise **Max output tokens per call** (for example to 12000), then click **Retry**. |
| A council member's answer was **“not in the required JSON format”** or had **no valid vote** | Click **Retry**. If it keeps happening, click **Start over** and choose a different model for that member. |
| The browser page is blank or says it can't connect | Make sure the black/Terminal window is still open. Its text shows the address to open (usually <http://localhost:8501>). |

---

# More details

## The council

| Member | Assigned perspective | Default model |
|---|---|---|
| **Melchior-1** · The Scientist | Evidence, logical consistency, feasibility, uncertainty | `openai/gpt-5` |
| **Balthasar-2** · The Caregiver | Relationships, responsibilities, empathy, effects on vulnerable people | `anthropic/claude-sonnet-4.5` |
| **Casper-3** · The Personal Self | Your autonomy, desires, identity, commitments, potential regret | `google/gemini-2.5-pro` |

The perspectives come from the instructions each model receives. No model is inherently more
logical, caring or intuitive, and which model plays which role is arbitrary. You can change
it in the left-hand panel.

## How the voting works

1. **Round 1: independent.** Each member receives the same case and only its own role, and
   votes without seeing any other member's answer. The three calls run at the same time.
   Each gives a vote, its reasoning, the strongest objection to its own vote, and the missing
   fact most likely to change its vote.
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

## Privacy

- **Nothing you type leaves your computer until you click a “Run” button.** When the app
  starts, it downloads OpenRouter's public list of models. That request contains none of
  your case text.
- When you click “Run”, your case is sent to **OpenRouter** and to the companies running the
  three models (e.g. OpenAI, Anthropic, Google). Their data policies apply. Review your
  settings at <https://openrouter.ai/settings/privacy>, and leave out names and details you
  don't need.
- **The app saves no history.** Your case and results exist only in your browser tab and are
  gone when you refresh or close it. The optional **Download report** button is the only way
  to keep a copy.
- Your API key is saved only in `.streamlit/secrets.toml` inside the app folder. This file is
  listed in `.gitignore`, so git will never upload it.
- The app only accepts connections from your own computer (`localhost`), and Streamlit's
  anonymous usage statistics are turned off (see `.streamlit/config.toml`).

## Costs

- **Every model call may cost money**, charged to your OpenRouter credit. Each round makes 3
  calls, so a full deliberation makes 6 (plus any retries).
- Before each round, the app shows an **upper-bound estimate** from OpenRouter's prices. It
  assumes every model writes as much as it's allowed to, so real costs are usually much lower.
- After each call, the app shows the cost OpenRouter reported, and the left-hand panel keeps
  a running total. Your authoritative record is <https://openrouter.ai/activity>.
- To limit the worst case, lower **Max output tokens per call**, choose cheaper models, or set
  a credit limit on your key.

## Changing models and roles

- **In the app:** edit the model IDs in the left-hand panel. They're checked against
  OpenRouter's live list of models. **Browse the OpenRouter model catalogue**, at the bottom of
  the page, lists every model with its price. Models are locked while a deliberation is open;
  click **Start over** to change them.
- **Defaults:** edit `default_model` in `config.py`.
- **Role instructions:** edit `perspective` in `config.py`. The rules shared by all members
  and the instructions for each round are in `council_logic.py`.

## For people comfortable with the command line

The start files run `launch.py`, which you can also run yourself. To do everything by hand
instead, from the app folder:

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # then put your key in it
python -m streamlit run app.py
```

You can set the `OPENROUTER_API_KEY` environment variable instead of creating the secrets
file. If both are set, the secrets file is used.

Automated tests use a fake OpenRouter, so they need no key, no internet and no money:

```bash
python -m pytest
```

They cover every combination of votes, the NO VERDICT rule, abstentions never becoming YES or
NO, round independence, nothing being sent before the button click or with invalid inputs,
key handling, unknown model IDs, API errors, retries, cost display, and the app writing no
files.

## Project files

| File | What it is |
|---|---|
| `start-windows.bat`, `start-mac.command` | Start files: find Python, then run `launch.py` |
| `launch.py` | Asks for your key, installs what's needed, starts the app |
| `app.py` | The web page |
| `council_logic.py` | Prompts, answer parsing, vote counting, cost estimates, report |
| `openrouter_client.py` | Talks to OpenRouter and turns errors into plain messages |
| `config.py` | The three roles, default models and limits |
| `.streamlit/config.toml` | Local-only server, no usage statistics, no Deploy button |
| `.streamlit/secrets.toml.example` | Example key file (the start file creates the real one) |
| `tests/` | Automated tests |

## Limitations

- The default model IDs were chosen when this was written. OpenRouter retires models, so the
  app checks every ID against the live list and suggests replacements.
- Cost figures are estimates or OpenRouter-reported values. Your OpenRouter activity page is
  the authoritative record.
- AI models can misread a case, invent details, or answer differently each time. Treat the
  council as a structured way to surface arguments and missing facts, not as an authority.
