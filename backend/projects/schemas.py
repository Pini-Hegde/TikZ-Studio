from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from utils import config

# Looser than compile validation on purpose: a half-renamed or empty project must still save.


class StoredFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    name: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    content: str

    @field_validator("content")
    @classmethod
    def check_size(cls, v: str) -> str:
        if len(v.encode()) > config.MAX_FILE_BYTES:
            raise ValueError(f"File exceeds the {config.MAX_FILE_BYTES} byte limit.")
        return v


class ProjectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    tags: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]] = Field(default=[], max_length=20)
    isArchived: bool = False
    files: list[StoredFile] = Field(default=[], max_length=config.MAX_FILE_COUNT)

    @model_validator(mode="after")
    def check_total_size(self):
        if sum(len(f.content.encode()) for f in self.files) > config.MAX_PROJECT_BYTES:
            raise ValueError(f"Project exceeds the {config.MAX_PROJECT_BYTES} byte limit.")
        return self
