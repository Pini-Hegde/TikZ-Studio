import os
import signal
import subprocess
import tempfile
import threading
from pathlib import Path

from schemas.compiler import CompileRequest
from utils import config
from utils.errors import AppError

# Each compile is CPU and memory heavy; cap how many run at once.
_slots = threading.BoundedSemaphore(config.MAX_CONCURRENT_COMPILES)

# latexmk's flag for each engine in schemas.compiler.ENGINES.
_ENGINE_FLAGS = {"pdflatex": "-pdf", "xelatex": "-xelatex", "lualatex": "-lualatex"}


def _latexmk(project_dir: Path, tex_home: Path, main: str, engine: str) -> int:
    """Run the engine, bibtex/biber when the document has a bibliography, and reruns until references settle."""
    with (tex_home / "latexmk.out").open("wb") as out:
        proc = subprocess.Popen(
            [
                "latexmk",
                "-norc",  # never read a latexmkrc: it is Perl, and the user's files could include one
                "-silent",  # its own messages only (e.g. "bib file not found"), not the engine's chatter
                _ENGINE_FLAGS[engine],
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-file-line-error",
                "-no-shell-escape",
                main,
            ],
            cwd=project_dir,
            # Minimal env: the TeX tools never see server secrets (e.g. future model API keys).
            env={
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": str(tex_home),
                "TEXMFCONFIG": str(tex_home / "config"),
                "TEXMFVAR": str(tex_home / "var"),
                "openin_any": "p",
                "openout_any": "p",
            },
            # The engine logs to <name>.log, latexmk to a file outside the project: never buffered in RAM.
            stdout=out,
            stderr=subprocess.STDOUT,
            # Own process group, so a timeout also kills the engine and bibtex that latexmk started.
            start_new_session=True,
        )
        try:
            return proc.wait(timeout=config.COMPILE_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise


def _png(project_dir: Path, pdf_path: Path) -> Path:
    """Render page 1 of the PDF as a PNG (for figure previews: a plain image instead of a PDF viewer)."""
    subprocess.run(
        ["pdftoppm", "-png", "-r", "220", "-f", "1", "-l", "1", "-singlefile", str(pdf_path), str(project_dir / "preview")],
        cwd=project_dir,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=config.COMPILE_TIMEOUT_S,
        check=True,
    )
    return project_dir / "preview.png"


def _log_tail(path: Path) -> str:
    try:
        with path.open("rb") as f:
            size = f.seek(0, os.SEEK_END)
            f.seek(max(0, size - config.MAX_LOG_CHARS))
            text = f.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return ""
    return text if size <= config.MAX_LOG_CHARS else "[log truncated]\n\n" + text


def _full_log(log_path: Path, tex_home: Path) -> str:
    """The TeX log, then bibtex/biber's log and latexmk's messages: a missing or broken .bib only shows up there."""
    log = _log_tail(log_path)
    for title, path in (("Bibliography log", log_path.with_suffix(".blg")), ("latexmk", tex_home / "latexmk.out")):
        if path.is_file():
            log += f"\n\n--- {title} ---\n" + _log_tail(path)
    return log


def compile_project(project: CompileRequest, png: bool = False) -> tuple[str, bytes]:
    """Return (file name, bytes) of the PDF, or of a PNG of its first page when `png`; or raise AppError."""
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
                if _latexmk(project_dir, tex_home, project.mainFileName, project.engine) != 0:
                    raise AppError(422, "COMPILE_FAILED", "LaTeX compilation failed.", log=_full_log(log_path, tex_home))
            except FileNotFoundError:
                raise AppError(503, "COMPILER_UNAVAILABLE", "The LaTeX compiler is unavailable.", log="")
            except subprocess.TimeoutExpired:
                raise AppError(408, "COMPILE_TIMEOUT", "LaTeX compilation exceeded the time limit.", log=_full_log(log_path, tex_home))

            pdf_path = project_dir / f"{stem}.pdf"
            if not pdf_path.is_file():
                raise AppError(422, "COMPILE_FAILED", "LaTeX produced no PDF.", log=_log_tail(log_path))
            if pdf_path.stat().st_size > config.MAX_PDF_BYTES:
                raise AppError(413, "OUTPUT_TOO_LARGE", "The compiled PDF exceeds the output size limit.", log="")
            if not png:
                return pdf_path.name, pdf_path.read_bytes()

            try:
                png_path = _png(project_dir, pdf_path)
            except FileNotFoundError:
                raise AppError(503, "COMPILER_UNAVAILABLE", "The preview renderer is unavailable.", log="")
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                raise AppError(422, "COMPILE_FAILED", "The PDF could not be rendered as an image.", log="")
            if not png_path.is_file() or png_path.stat().st_size > config.MAX_PDF_BYTES:
                raise AppError(413, "OUTPUT_TOO_LARGE", "The preview image exceeds the output size limit.", log="")
            return f"{stem}.png", png_path.read_bytes()
    finally:
        _slots.release()
