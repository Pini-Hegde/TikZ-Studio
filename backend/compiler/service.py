import os
import subprocess
import tempfile
import threading
from pathlib import Path

from compiler.schemas import CompileRequest
from utils import config
from utils.errors import AppError

# Each pdflatex run is CPU and memory heavy; cap how many run at once.
_slots = threading.BoundedSemaphore(config.MAX_CONCURRENT_COMPILES)


def _pdflatex(project_dir: Path, tex_home: Path, main: str) -> int:
    return subprocess.run(
        [
            "pdflatex",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "-no-shell-escape",
            f"-output-directory={project_dir}",
            main,
        ],
        cwd=project_dir,
        # Minimal env: pdflatex never sees server secrets (e.g. future model API keys).
        env={
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(tex_home),
            "TEXMFCONFIG": str(tex_home / "config"),
            "TEXMFVAR": str(tex_home / "var"),
            "openin_any": "p",
            "openout_any": "p",
        },
        # Output goes to <name>.log; not buffering stdout keeps a runaway document from eating RAM.
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=config.COMPILE_TIMEOUT_S,
    ).returncode


def _log_tail(path: Path) -> str:
    try:
        with path.open("rb") as f:
            size = f.seek(0, os.SEEK_END)
            f.seek(max(0, size - config.MAX_LOG_CHARS))
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return ""
    return text if size <= config.MAX_LOG_CHARS else "[log truncated]\n\n" + text


def compile_project(project: CompileRequest) -> tuple[str, bytes]:
    """Return (pdf file name, pdf bytes) or raise AppError."""
    if not _slots.acquire(timeout=10):
        raise AppError(503, "COMPILER_BUSY", "The compiler is busy. Try again shortly.")
    try:
        with tempfile.TemporaryDirectory(prefix="tikz-studio-") as tmp:
            # User files live in project/; TeX caches live beside it so uploads can't overwrite them.
            project_dir, tex_home = Path(tmp, "project"), Path(tmp, "tex")
            project_dir.mkdir()
            tex_home.mkdir()

            try:
                for f in project.files:
                    path = project_dir / f.name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(f.content, encoding="utf-8")
            except (FileExistsError, NotADirectoryError, IsADirectoryError):
                raise AppError(400, "INVALID_REQUEST", "A file name conflicts with a folder name.")

            stem = Path(project.mainFileName).stem
            log_path = project_dir / f"{stem}.log"
            try:
                for _ in range(2):  # second pass resolves references
                    if _pdflatex(project_dir, tex_home, project.mainFileName) != 0:
                        raise AppError(422, "COMPILE_FAILED", "LaTeX compilation failed.", log=_log_tail(log_path))
            except FileNotFoundError:
                raise AppError(503, "COMPILER_UNAVAILABLE", "The LaTeX compiler is unavailable.", log="")
            except subprocess.TimeoutExpired:
                raise AppError(408, "COMPILE_TIMEOUT", "LaTeX compilation exceeded the time limit.", log=_log_tail(log_path))

            pdf_path = project_dir / f"{stem}.pdf"
            if not pdf_path.is_file():
                raise AppError(422, "COMPILE_FAILED", "LaTeX produced no PDF.", log=_log_tail(log_path))
            if pdf_path.stat().st_size > config.MAX_PDF_BYTES:
                raise AppError(413, "OUTPUT_TOO_LARGE", "The compiled PDF exceeds the output size limit.", log="")
            return pdf_path.name, pdf_path.read_bytes()
    finally:
        _slots.release()
