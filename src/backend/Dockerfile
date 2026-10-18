FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      latexmk \
      biber \
      texlive-bibtex-extra \
      texlive-fonts-recommended \
      texlive-latex-base \
      texlive-latex-extra \
      texlive-luatex \
      texlive-pictures \
      texlive-publishers \
      texlive-xetex \
      poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    # lualatex's font index, built once here; otherwise every compile would rebuild it.
    && luaotfload-tool --update \
    && useradd --system --uid 1000 --no-create-home app

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Code stays root-owned: the app user can run it but not modify it.
COPY . .

USER app

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4000/health')"

# One worker on purpose: the rate limiter lives in process memory (see utils/security.py).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4000", "--no-server-header", "--timeout-graceful-shutdown", "25"]
