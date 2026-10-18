from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from utils import config
from utils.security import safe_relative_path

# The LaTeX engines the compiler runs. The frontend gets this list from GET /api/v1/compile/engines.
ENGINES = ("pdflatex", "xelatex", "lualatex")
DEFAULT_ENGINE = "pdflatex"
Engine = Literal[ENGINES]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]


class ProjectFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name
    content: str

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        return safe_relative_path(v)

    @field_validator("content")
    @classmethod
    def check_size(cls, v: str) -> str:
        if len(v.encode()) > config.MAX_FILE_BYTES:
            raise ValueError(f"File exceeds the {config.MAX_FILE_BYTES} byte limit.")
        return v


class CompileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mainFileName: Name
    engine: Engine = DEFAULT_ENGINE
    files: list[ProjectFile] = Field(min_length=1, max_length=config.MAX_FILE_COUNT)

    @field_validator("mainFileName")
    @classmethod
    def check_main(cls, v: str) -> str:
        v = safe_relative_path(v)
        if not v.lower().endswith(".tex"):
            raise ValueError("The main file must use the .tex extension.")
        return v

    @model_validator(mode="after")
    def check_project(self):
        names = [f.name for f in self.files]
        if len(names) != len(set(names)):
            raise ValueError("File names must be unique.")
        if sum(len(f.content.encode()) for f in self.files) > config.MAX_PROJECT_BYTES:
            raise ValueError(f"Project exceeds the {config.MAX_PROJECT_BYTES} byte limit.")
        if self.mainFileName not in names:
            raise ValueError("The main file must be present in files.")
        return self
