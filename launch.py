"""Sets up and starts Decision Council.

You don't need to run this yourself: start-windows.bat (Windows) and
start-mac.command (Mac) run it for you. It:
  1. asks for your OpenRouter API key and saves it in .streamlit/secrets.toml,
     a private file that git never uploads;
  2. installs what the app needs into a private ".venv" folder (slow only
     the first time);
  3. the first time, puts a "Decision Council" shortcut on your Desktop;
  4. starts the app, which opens in your web browser.
"""

from __future__ import annotations

import base64
import os
import re
import shlex
import shutil
import subprocess
import sys
import sysconfig
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENV_DIR = HERE / ".venv"
SECRETS_FILE = HERE / ".streamlit" / "secrets.toml"
PLACEHOLDER = "your-key-here"
KEY_LINE = re.compile(r'^\s*OPENROUTER_API_KEY\s*=\s*"([^"]*)"', re.MULTILINE)
HELP = 'See "If something goes wrong" in README.md.'
SHORTCUT_NAME = "Decision Council"
# Remembers that the shortcut was offered, so a shortcut you delete stays deleted.
SHORTCUT_MARKER = VENV_DIR / "desktop-shortcut-created"


def say(text: str = "") -> None:
    print(text, flush=True)


def heading(text: str) -> None:
    say()
    say("-" * 60)
    say(text)
    say("-" * 60)


# --- Step 1: the API key ------------------------------------------------------


def read_saved_key(path: Path | None = None) -> str | None:
    """Return the saved key, or None if there isn't a usable one."""
    path = path or SECRETS_FILE
    try:
        match = KEY_LINE.search(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return None
    key = match.group(1).strip() if match else ""
    if not key or PLACEHOLDER in key:
        return None
    return key


def clean_key(text: str) -> str:
    """Remove spaces and quotes people often paste by accident."""
    return text.strip().strip("\"'").strip()


def key_problem(key: str) -> str | None:
    """Return what's wrong with a pasted key, or None if it looks fine."""
    if not key:
        return "Nothing was pasted."
    if not key.startswith("sk-or-"):
        return "That doesn't look like an OpenRouter key (they start with sk-or-)."
    if any(c.isspace() for c in key) or '"' in key or "'" in key:
        return "The key has spaces or quotes in the middle. Copy it again from OpenRouter."
    return None


def save_key(key: str, path: Path | None = None) -> None:
    path = path or SECRETS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# Your private OpenRouter API key. Don't share this file.\n"
        f'OPENROUTER_API_KEY = "{key}"\n',
        encoding="utf-8",
    )


def ask_for_key(input_fn=input) -> None:
    heading("STEP 1 OF 3: YOUR OPENROUTER KEY")
    saved = read_saved_key()
    if saved:
        say(f"Your key is already saved (it ends in ...{saved[-4:]}).")
        say("Press Enter (Return on a Mac) to keep it, or paste a new key and press Enter to replace it.")
    else:
        say("Paste your OpenRouter API key below, then press Enter (Return on a Mac).")
        say("  - To paste on Windows: press Ctrl+V, or right-click.")
        say("  - To paste on a Mac: press Command+V.")
        say("The key will show on screen. That's fine: it is only saved on this computer.")
    while True:
        try:
            entered = clean_key(input_fn("Key: "))
        except EOFError:
            entered = ""
            if not saved:
                raise SystemExit("No key was entered, so the app can't start. " + HELP)
        if not entered and saved:
            say("OK, keeping your saved key.")
            return
        problem = key_problem(entered)
        if problem is None:
            save_key(entered)
            say(f"Saved your key (it ends in ...{entered[-4:]}).")
            return
        say(problem + " Please try again.")


# --- Step 2: install ----------------------------------------------------------


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def _create_and_install() -> bool:
    if not venv_python().exists():
        say("First time only: this takes a few minutes and may look stuck. Please wait...")
        try:
            venv.EnvBuilder(with_pip=True).create(VENV_DIR)
        except Exception as exc:  # e.g. a Python installed without venv support
            say(f"Could not create the app's private Python folder: {exc}")
            return False
    else:
        say("Checking everything is installed...")
    result = subprocess.run(
        [
            str(venv_python()),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--quiet",
            "-r",
            str(HERE / "requirements.txt"),
        ]
    )
    return result.returncode == 0


WINDOWS_ARM_HELP = (
    "Your Python is the version for Windows computers with ARM processors (such as "
    "Snapdragon). Some parts this app needs aren't available for that version yet. Fix: "
    "uninstall Python (Settings > Apps), then install it again from "
    "https://www.python.org/downloads/windows/ choosing the 'Windows installer (64-bit)' "
    "download, not the ARM64 one. Then start the app again. It runs fine that way."
)


def install() -> None:
    heading("STEP 2 OF 3: INSTALLING WHAT THE APP NEEDS")
    if _create_and_install():
        say("Done.")
        return
    if sysconfig.get_platform() == "win-arm64":
        shutil.rmtree(VENV_DIR, ignore_errors=True)
        raise SystemExit("Installing failed. " + WINDOWS_ARM_HELP)
    say()
    say("That didn't work. Trying once more from scratch...")
    shutil.rmtree(VENV_DIR, ignore_errors=True)
    if _create_and_install():
        say("Done.")
        return
    raise SystemExit(
        "Installing failed. Check that you're connected to the internet, then start the app again. "
        + HELP
    )


# --- Desktop shortcut ---------------------------------------------------------


def mac_shortcut_script(start_file: Path) -> str:
    app = shlex.quote(str(start_file))
    return f"""#!/bin/bash
# Shortcut to Decision Council, made by its start file. Double-click to start the app.
# To remove the shortcut, just delete this file.
APP={app}
if [ ! -f "$APP" ]; then
  echo "The Decision Council folder was moved or deleted, so this shortcut no longer works."
  echo "Open the app folder and start it once with start-mac: that fixes this shortcut."
  read -r -p "Press Return to close..." _
  exit 1
fi
exec bash "$APP"
"""


def _mac_shortcut(update_only: bool) -> Path | None:
    link = Path.home() / "Desktop" / f"{SHORTCUT_NAME}.command"
    if update_only and not link.exists():
        return None
    link.write_text(mac_shortcut_script(HERE / "start-mac.command"), encoding="utf-8")
    link.chmod(0o755)
    return link


# Runs in PowerShell. Paths arrive in environment variables, so no quoting problems.
WINDOWS_SHORTCUT_PS = r"""
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop ($env:DC_NAME + '.lnk')
if ($env:DC_UPDATE_ONLY -eq '1' -and -not (Test-Path -LiteralPath $link)) { exit 0 }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = $env:ComSpec
$shortcut.Arguments = '/c ""' + $env:DC_START + '""'
$shortcut.WorkingDirectory = $env:DC_DIR
$shortcut.Description = 'Start Decision Council'
$shortcut.Save()
Write-Output $link
"""


def _windows_shortcut(update_only: bool) -> Path | None:
    env = dict(
        os.environ,
        DC_NAME=SHORTCUT_NAME,
        DC_START=str(HERE / "start-windows.bat"),
        DC_DIR=str(HERE),
        DC_UPDATE_ONLY="1" if update_only else "0",
    )
    encoded = base64.b64encode(WINDOWS_SHORTCUT_PS.encode("utf-16-le")).decode("ascii")
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise OSError(result.stderr.strip() or "PowerShell failed")
    path = result.stdout.strip()
    return Path(path) if path else None


def make_desktop_shortcut() -> None:
    """Create the shortcut the first time. After that, only keep an existing
    one pointing at this folder (in case you moved the folder)."""
    if sys.platform == "darwin":
        create = _mac_shortcut
    elif os.name == "nt":
        create = _windows_shortcut
    else:
        return
    first_time = not SHORTCUT_MARKER.exists()
    try:
        link = create(update_only=not first_time)
    except Exception:
        if first_time:
            say("(Couldn't put a shortcut on your Desktop. You can still start the app the usual way.)")
        return
    if first_time:
        try:
            SHORTCUT_MARKER.write_text("yes\n")
        except OSError:
            pass
        if link:
            say(f'Made a "{SHORTCUT_NAME}" shortcut on your Desktop.')
            say("Next time, just double-click it to start the app.")


# --- Step 3: run --------------------------------------------------------------


def run_app() -> None:
    heading("STEP 3 OF 3: STARTING THE APP")
    say("Your web browser will open the app in a few seconds.")
    say("If it doesn't, open your browser and go to the address shown below")
    say("(usually http://localhost:8501).")
    say()
    say(">>> KEEP THIS WINDOW OPEN while you use the app. <<<")
    say("    Closing this window stops the app. It's fine to minimise it.")
    say("    More text may appear below. That's normal.")
    say()
    try:
        subprocess.run([str(venv_python()), "-m", "streamlit", "run", str(HERE / "app.py")], cwd=HERE)
    except KeyboardInterrupt:
        pass
    say()
    say("The app has stopped. You can close this window.")


def main() -> None:
    os.chdir(HERE)
    say("=" * 60)
    say("  DECISION COUNCIL")
    say("=" * 60)
    if sys.version_info < (3, 10):
        raise SystemExit("This app needs Python 3.10 or newer. " + HELP)
    ask_for_key()
    install()
    make_desktop_shortcut()
    run_app()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        say()
        say("Stopped.")
