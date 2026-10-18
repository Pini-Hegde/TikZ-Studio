from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(max_length=2000)]


class StoredVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Annotated[str, StringConstraints(max_length=20000)]


class StoredTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request: Text
    prompt: Text
    isRevision: bool = False
    variants: list[StoredVariant] = Field(default=[], max_length=20)
    active: int = Field(default=0, ge=0)
    error: Annotated[str, StringConstraints(max_length=500)] | None = None


class Refining(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn: int = Field(ge=0)
    variant: int = Field(ge=0)


class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    projectId: UUID | None = None
    turns: list[StoredTurn] = Field(default=[], max_length=200)
    refining: Refining | None = None
