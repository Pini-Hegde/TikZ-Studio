"""LLM code generation: `/! instruction !/` in the editor -> LaTeX, and a figure prompt -> several TikZ variants."""

from concurrent.futures import ThreadPoolExecutor
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from utils import config, model
from utils.auth import current_user
from utils.errors import AppError

router = APIRouter(prefix="/api/v1/generate")

SYSTEM_PROMPT = (
    "You write LaTeX. Reply with only the LaTeX code that fulfils the instruction, to be pasted into the body "
    "of an existing document: no \\documentclass, no \\begin{document}, no explanations, no markdown fences. "
    "Only use commands, packages and TikZ libraries (\\usetikzlibrary) loaded in the given preamble; if one is "
    "missing, use an alternative that works without it (e.g. rounded corners instead of the shapes library)."
)
TIKZ_SYSTEM_PROMPT = (
    "You draw scientific figures in TikZ. Reply with only one \\begin{tikzpicture}...\\end{tikzpicture} block, "
    "to be pasted into the body of an existing document: no \\documentclass, no \\usepackage, no \\usetikzlibrary, "
    "no \\begin{document}, no explanations, no markdown fences. Only use packages and TikZ libraries loaded in the "
    "given preamble; if one is missing, use an alternative that works without it. Every line meant to be seen must "
    "be drawn: \\path draws nothing unless its options or style include draw."
)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instruction: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    preamble: Annotated[str, StringConstraints(max_length=8000)] = ""


class FigureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    preamble: Annotated[str, StringConstraints(max_length=8000)] = ""
    # A follow-up turn: the variant the user picked (possibly edited) and what to change about it.
    code: Annotated[str, StringConstraints(max_length=20000)] = ""
    change: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""

    @model_validator(mode="after")
    def check_revision(self):
        if bool(self.code.strip()) != bool(self.change):
            raise ValueError("A change request needs both code and change.")
        return self


# Plain `def`: the blocking HTTP call runs in a worker thread. Signed-in only: every call costs quota.
@router.post("", dependencies=[Depends(current_user)])
def generate(body: GenerateRequest):
    if not config.GROQ_API_KEY:
        raise AppError(503, "GENERATION_NOT_CONFIGURED", "Code generation is not configured.")
    code = model.chat(
        config.GROQ_URL,
        config.GROQ_API_KEY,
        config.GROQ_MODEL,
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Preamble:\n{body.preamble or '(none)'}\n\nInstruction: {body.instruction}"},
        ],
        temperature=0.2,
        max_tokens=1500,
    )
    return {"code": code}


@router.post("/tikz", dependencies=[Depends(current_user)])
def generate_tikz(body: FigureRequest):
    if not config.TIKZ_MODEL_URL:
        raise AppError(503, "GENERATION_NOT_CONFIGURED", "Figure generation is not configured.")
    messages = [
        {"role": "system", "content": TIKZ_SYSTEM_PROMPT},
        {"role": "user", "content": f"Preamble:\n{body.preamble or '(none)'}\n\nFigure: {body.prompt}"},
    ]
    if body.code:
        # Revision: one answer that applies the change, like a chat reply.
        messages += [
            {"role": "assistant", "content": body.code},
            {"role": "user", "content": f"Change request: {body.change}\nReply with the full updated tikzpicture."},
        ]
    count, temperature = (1, 0.3) if body.code else (config.TIKZ_VARIANTS, 0.9)  # high temperature: variants differ

    def variant(_):
        try:
            return model.chat(
                config.TIKZ_MODEL_URL, config.TIKZ_MODEL_API_KEY, config.TIKZ_MODEL, messages,
                temperature=temperature, max_tokens=3000, timeout=90,
            )
        except AppError as e:
            return e

    # One request per variant, all at once: works with every OpenAI-compatible server, unlike the `n` parameter.
    with ThreadPoolExecutor(count) as pool:
        results = list(pool.map(variant, range(count)))
    variants = [r for r in results if isinstance(r, str)]
    if not variants:
        raise results[0]
    return {"variants": variants}
