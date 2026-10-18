"""Chat call to any OpenAI-compatible model server: Groq today, a server hosting our own weights (vLLM, Ollama, TGI) later."""

import json
import re
import urllib.error
import urllib.request

from utils.errors import AppError, log

FENCE = re.compile(r"^\s*```[a-zA-Z]*\s*\n(.*?)\n?```\s*$", re.S)


def strip_fences(text: str) -> str:
    match = FENCE.match(text)
    return (match.group(1) if match else text).strip()


def chat(url: str, key: str, model: str, messages: list[dict], *, temperature: float, max_tokens: int, timeout: float = 30) -> str:
    """Blocking. Returns the reply without markdown fences; raises AppError on any failure."""
    # Groq's CDN rejects urllib's default User-Agent. A self-hosted server may need no key.
    headers = {"Content-Type": "application/json", "User-Agent": "tikz-studio"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps({"model": model, "temperature": temperature, "max_tokens": max_tokens, "messages": messages}).encode(),
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        log.warning("Model error %s: %s", e.code, e.read()[:500])
        if e.code == 429:
            raise AppError(429, "GENERATION_BUSY", "The model is busy. Try again in a minute.")
        raise AppError(502, "GENERATION_FAILED", "The model could not generate code.")
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log.warning("Model unreachable: %s", e)
        raise AppError(502, "GENERATION_FAILED", "The model could not be reached.")

    try:
        code = strip_fences(data["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError):
        code = ""
    if not code:
        raise AppError(502, "GENERATION_FAILED", "The model returned no code.")
    return code
