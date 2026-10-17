"""`/! instruction !/` in the editor -> LaTeX code, via Groq's OpenAI-compatible chat API."""

import json
import re
import urllib.error
import urllib.request
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, StringConstraints

from utils import config
from utils.auth import current_user
from utils.errors import AppError, log

router = APIRouter(prefix="/api/v1/generate")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM_PROMPT = (
    "You write LaTeX. Reply with only the LaTeX code that fulfils the instruction, to be pasted into the body "
    "of an existing document: no \\documentclass, no \\begin{document}, no explanations, no markdown fences. "
    "Only use commands, packages and TikZ libraries (\\usetikzlibrary) loaded in the given preamble; if one is "
    "missing, use an alternative that works without it (e.g. rounded corners instead of the shapes library)."
)
FENCE = re.compile(r"^\s*```[a-zA-Z]*\s*\n(.*?)\n?```\s*$", re.S)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    preamble: Annotated[str, StringConstraints(max_length=8000)] = ""


def strip_fences(text: str) -> str:
    match = FENCE.match(text)
    return (match.group(1) if match else text).strip()


# Plain `def`: the blocking HTTP call runs in a worker thread. Signed-in only: every call costs quota.
@router.post("", dependencies=[Depends(current_user)])
def generate(body: GenerateRequest):
    if not config.GROQ_API_KEY:
        raise AppError(503, "GENERATION_NOT_CONFIGURED", "Code generation is not configured.")

    request = urllib.request.Request(
        GROQ_URL,
        method="POST",
        data=json.dumps({
            "model": config.GROQ_MODEL,
            "temperature": 0.2,
            "max_tokens": 1500,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Preamble:\n{body.preamble or '(none)'}\n\nInstruction: {body.instruction}"},
            ],
        }).encode(),
        # Groq's CDN rejects urllib's default User-Agent.
        headers={"Authorization": f"Bearer {config.GROQ_API_KEY}", "Content-Type": "application/json", "User-Agent": "tikz-studio"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        log.warning("Groq error %s: %s", e.code, e.read()[:500])
        if e.code == 429:
            raise AppError(429, "GENERATION_BUSY", "The model is busy. Try again in a minute.")
        raise AppError(502, "GENERATION_FAILED", "The model could not generate code.")
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log.warning("Groq unreachable: %s", e)
        raise AppError(502, "GENERATION_FAILED", "The model could not be reached.")

    try:
        code = strip_fences(data["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError):
        code = ""
    if not code:
        raise AppError(502, "GENERATION_FAILED", "The model returned no code.")
    return {"code": code}
