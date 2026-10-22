# Overleaf's default compiler: TeX Live 2026 with every package and font, so documents build and look the same.
# Pinned by digest (the tag is rebuilt weekly); bump it deliberately, e.g. for TeX Live 2027.
FROM texlive/texlive:latest@sha256:e8148b126545105c4aeeaa212f8a7bd02d05b500351372881055e1e59ae67d33

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get install --no-install-recommends -y poppler-utils python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    # lualatex's font index, built once here; otherwise every compile would rebuild it.
    && luaotfload-tool --update \
    && python3 -m venv /opt/venv

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Code stays root-owned: the app user can run it but not modify it.
COPY . .

# The image's own unprivileged user (uid 1000).
USER texlive

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4000/health')"

# One worker on purpose: the rate limiter lives in process memory (see utils/security.py).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4000", "--no-server-header", "--timeout-graceful-shutdown", "25"]
