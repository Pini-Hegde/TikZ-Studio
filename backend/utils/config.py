"""All settings come from environment variables so nothing secret lives in code."""

import os


def env_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return value


CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
if "*" in CORS_ORIGINS:
    raise ValueError("CORS_ORIGINS must list explicit origins, not '*'.")

MAX_BODY_BYTES = env_int("MAX_BODY_BYTES", 3 * 1024 * 1024)
RATE_LIMIT_PER_MINUTE = env_int("RATE_LIMIT_PER_MINUTE", 20)  # compile
AUTH_RATE_LIMIT_PER_MINUTE = env_int("AUTH_RATE_LIMIT_PER_MINUTE", 10)  # login/signup brute force
API_RATE_LIMIT_PER_MINUTE = env_int("API_RATE_LIMIT_PER_MINUTE", 120)  # everything else (autosave)
GENERATE_RATE_LIMIT_PER_MINUTE = env_int("GENERATE_RATE_LIMIT_PER_MINUTE", 10)  # LLM calls cost quota

# Supabase Cloud. Only the publishable (anon) key: every query runs as the signed-in user,
# so Postgres row-level security decides what they can touch. Never put the service_role key here.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
# Secure cookies are only sent over HTTPS. Keep true when hosted; false only for plain-http local dev.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"

COMPILE_TIMEOUT_S = env_int("COMPILE_TIMEOUT_MS", 20_000) / 1000
MAX_CONCURRENT_COMPILES = env_int("MAX_CONCURRENT_COMPILES", 2)
MAX_FILE_COUNT = env_int("MAX_FILE_COUNT", 25)
MAX_FILE_BYTES = env_int("MAX_FILE_BYTES", 512 * 1024)
MAX_PROJECT_BYTES = env_int("MAX_PROJECT_BYTES", 2 * 1024 * 1024)
MAX_PDF_BYTES = env_int("MAX_PDF_BYTES", 10 * 1024 * 1024)
MAX_LOG_CHARS = env_int("MAX_LOG_CHARACTERS", 24_000)

# Groq (OpenAI-compatible) for `! instruction !` code generation. Unset key = feature answers 503.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
