import pytest
import requests

import openrouter_client as orc

KEY = "sk-or-v1-secret-test-key"


class FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.fixture
def post(monkeypatch):
    """Replace requests.post; set .response (or .exception) before calling."""

    class Fake:
        response = None
        exception = None
        calls = []

        def __call__(self, url, json=None, headers=None, timeout=None):
            self.calls.append({"url": url, "json": json, "headers": headers})
            if self.exception:
                raise self.exception
            return self.response

    fake = Fake()
    fake.calls = []
    monkeypatch.setattr(orc.requests, "post", fake)
    return fake


def ok_body(content="hello", finish_reason="stop", usage=None):
    return {
        "model": "openai/gpt-5",
        "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
        "usage": usage if usage is not None else {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001},
    }


def call():
    return orc.chat_completion(KEY, "openai/gpt-5", [{"role": "user", "content": "hi"}], 100)


def test_success_returns_text_and_usage(post):
    post.response = FakeResponse(200, ok_body())
    reply = call()
    assert reply["text"] == "hello"
    assert reply["usage"]["cost"] == 0.001
    sent = post.calls[0]
    assert sent["url"].endswith("/chat/completions")
    assert sent["headers"]["Authorization"] == f"Bearer {KEY}"
    assert sent["json"]["model"] == "openai/gpt-5"
    assert sent["json"]["usage"] == {"include": True}
    assert "tools" not in sent["json"], "the app must never give models tools to act with"


def test_missing_key_sends_nothing(post):
    with pytest.raises(orc.OpenRouterError, match="No OpenRouter API key"):
        orc.chat_completion("", "openai/gpt-5", [], 100)
    assert post.calls == []


@pytest.mark.parametrize(
    "status, body, expected",
    [
        (401, {"error": {"code": 401, "message": "No auth credentials found"}}, "rejected your API key"),
        (402, {"error": {"code": 402, "message": "Insufficient credits"}}, "enough credit"),
        (400, {"error": {"code": 400, "message": "openai/gpt-x is not a valid model ID"}}, "did not accept the model ID"),
        (404, {"error": {"code": 404, "message": "No endpoints found"}}, "could not find a way to run"),
        (429, {"error": {"code": 429, "message": "Rate limit exceeded"}}, "Rate limited"),
        (502, {"error": {"code": 502, "message": "Provider returned error"}}, "down or overloaded"),
        (500, ValueError("not json"), "unexpected error (500)"),
        # OpenRouter can put an error inside an HTTP 200 response
        (200, {"error": {"code": 502, "message": "upstream failed"}}, "down or overloaded"),
    ],
)
def test_http_errors_become_friendly_messages(post, status, body, expected):
    post.response = FakeResponse(status, body)
    with pytest.raises(orc.OpenRouterError) as info:
        call()
    assert expected in str(info.value)
    assert KEY not in str(info.value)


def test_empty_answer_after_reasoning_keeps_usage_for_cost_tracking(post):
    usage = {"prompt_tokens": 10, "completion_tokens": 100, "cost": 0.002}
    post.response = FakeResponse(200, ok_body(content="", finish_reason="length", usage=usage))
    with pytest.raises(orc.OpenRouterError, match="Max output tokens") as info:
        call()
    assert info.value.usage == usage


def test_content_as_list_of_parts(post):
    body = ok_body()
    body["choices"][0]["message"]["content"] = [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
    post.response = FakeResponse(200, body)
    assert call()["text"] == "ab"


@pytest.mark.parametrize(
    "exc, expected",
    [(requests.Timeout(), "did not answer within"), (requests.ConnectionError(), "Could not reach OpenRouter")],
)
def test_network_errors(post, exc, expected):
    post.exception = exc
    with pytest.raises(orc.OpenRouterError, match=expected):
        call()


def test_fetch_models(monkeypatch):
    body = {"data": [{"id": "openai/gpt-5"}, {"no_id": True}, "junk"]}
    monkeypatch.setattr(orc.requests, "get", lambda url, timeout: FakeResponse(200, body))
    assert orc.fetch_models() == [{"id": "openai/gpt-5"}]


def test_fetch_models_offline(monkeypatch):
    def boom(url, timeout):
        raise requests.ConnectionError()

    monkeypatch.setattr(orc.requests, "get", boom)
    with pytest.raises(orc.OpenRouterError, match="Could not reach OpenRouter"):
        orc.fetch_models()


def test_base_url_override(monkeypatch):
    monkeypatch.setenv("OPENROUTER_BASE_URL", "http://localhost:9999/api/v1/")
    assert orc.base_url() == "http://localhost:9999/api/v1"
    monkeypatch.delenv("OPENROUTER_BASE_URL")
    assert orc.base_url() == "https://openrouter.ai/api/v1"
