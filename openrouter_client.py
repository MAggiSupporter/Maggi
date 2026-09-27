"""Minimal OpenRouter client: load the model catalogue and send chat requests.

Every failure becomes an OpenRouterError whose message is safe and helpful to
show in the app. The API key is only ever sent in the Authorization header
and never included in error messages.
"""

from __future__ import annotations

import os

import requests

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def base_url() -> str:
    # OPENROUTER_BASE_URL is only for testing against a fake server.
    return os.environ.get("OPENROUTER_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


class OpenRouterError(Exception):
    """An error with a user-friendly message.

    `usage` holds token usage when the call was billed despite failing
    (for example, the model spent all its tokens reasoning and wrote nothing).
    """

    def __init__(self, message: str, usage: dict | None = None):
        super().__init__(message)
        self.usage = usage


def fetch_models(timeout: float = 15) -> list[dict]:
    """Return the list of models OpenRouter currently offers.

    This public endpoint needs no API key and sends no case data."""
    try:
        resp = requests.get(f"{base_url()}/models", timeout=timeout)
    except requests.RequestException as exc:
        raise OpenRouterError(
            "Could not reach OpenRouter to load the model catalogue "
            f"({type(exc).__name__}). Check your internet connection, then click "
            "“Reload model catalogue”."
        ) from exc
    if resp.status_code != 200:
        raise OpenRouterError(
            f"OpenRouter returned an error ({resp.status_code}) when loading the model "
            "catalogue. Try “Reload model catalogue” in a minute."
        )
    try:
        data = resp.json().get("data")
    except (ValueError, AttributeError):
        data = None
    if not isinstance(data, list):
        raise OpenRouterError("OpenRouter's model catalogue came back in an unexpected format.")
    return [m for m in data if isinstance(m, dict) and isinstance(m.get("id"), str)]


def _error_message(status: int, body, model: str) -> str:
    detail = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            detail = str(err.get("message") or "")
            raw = (err.get("metadata") or {}).get("raw") if isinstance(err.get("metadata"), dict) else None
            if raw and isinstance(raw, str) and raw not in detail:
                detail = f"{detail} ({raw[:300]})" if detail else raw[:300]
        elif isinstance(err, str):
            detail = err
    detail_text = f" OpenRouter said: “{detail}”" if detail else ""

    if status == 400 and "model" in detail.lower():
        return f"OpenRouter did not accept the model ID “{model}”.{detail_text}"
    if status == 400:
        return f"OpenRouter rejected the request as invalid (400).{detail_text}"
    if status == 401:
        return (
            "OpenRouter rejected your API key (401). Check that it was copied "
            "completely and has not been deleted or disabled at https://openrouter.ai/settings/keys"
        )
    if status == 402:
        return (
            "Your OpenRouter account does not have enough credit for this request (402). "
            "Add credit at https://openrouter.ai/settings/credits, or lower "
            "“Max output tokens per call” in the sidebar."
        )
    if status == 403:
        return f"The request was refused (403), possibly by a provider's content filter.{detail_text}"
    if status == 404:
        return (
            f"OpenRouter could not find a way to run “{model}” (404). The model may have "
            f"been removed, or none of its providers match your account's settings.{detail_text}"
        )
    if status == 408:
        return f"The request to “{model}” timed out (408). Try again.{detail_text}"
    if status == 429:
        return (
            f"Rate limited (429): too many requests to “{model}” right now. Wait a "
            f"minute and click retry.{detail_text}"
        )
    if status in (502, 503):
        return (
            f"The provider running “{model}” is down or overloaded ({status}). Try again "
            f"shortly, or choose a different model.{detail_text}"
        )
    return f"OpenRouter returned an unexpected error ({status}) for “{model}”.{detail_text}"


def chat_completion(
    api_key: str,
    model: str,
    messages: list[dict],
    max_tokens: int,
    timeout: float = 180,
) -> dict:
    """Send one chat request. Returns {"text", "finish_reason", "usage", "served_model"}."""
    if not api_key:
        raise OpenRouterError("No OpenRouter API key is set. See the README, step 3.")

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        # Ask OpenRouter to include the cost of the call in its response.
        "usage": {"include": True},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": "Decision Council",
    }
    try:
        resp = requests.post(
            f"{base_url()}/chat/completions", json=payload, headers=headers, timeout=timeout
        )
    except requests.Timeout as exc:
        raise OpenRouterError(
            f"“{model}” did not answer within {int(timeout)} seconds. Click retry, or choose a faster model."
        ) from exc
    except requests.RequestException as exc:
        raise OpenRouterError(
            f"Could not reach OpenRouter ({type(exc).__name__}). Check your internet connection and retry."
        ) from exc

    try:
        body = resp.json()
    except ValueError:
        body = None

    # OpenRouter can also report an error inside a 200 response.
    if resp.status_code != 200 or not isinstance(body, dict) or body.get("error"):
        status = resp.status_code
        if status == 200 and isinstance(body, dict) and isinstance(body.get("error"), dict):
            code = body["error"].get("code")
            status = code if isinstance(code, int) else 500
        raise OpenRouterError(_error_message(status, body, model))

    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    choices = body.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        raise OpenRouterError(f"“{model}” returned no answer. Click retry.", usage=usage)
    choice = choices[0]
    if choice.get("error"):
        raise OpenRouterError(
            _error_message(500, {"error": choice["error"]}, model), usage=usage
        )

    content = (choice.get("message") or {}).get("content")
    if isinstance(content, list):  # some providers return a list of parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    text = (content or "").strip()
    finish_reason = choice.get("finish_reason")

    if not text:
        if finish_reason == "length":
            raise OpenRouterError(
                f"“{model}” used all of its output tokens (probably on hidden reasoning) "
                "before writing an answer. Raise “Max output tokens per call” in the "
                "sidebar, then click retry.",
                usage=usage,
            )
        raise OpenRouterError(f"“{model}” returned an empty answer. Click retry.", usage=usage)

    return {
        "text": text,
        "finish_reason": finish_reason,
        "usage": usage,
        "served_model": body.get("model"),
    }
