"""
Schemas (modelos) de dados com Pydantic.

Um schema descreve o FORMATO esperado do JSON que chega na API. O FastAPI
usa esses modelos para:
- validar automaticamente (tipo errado ou campo faltando -> erro 422);
- converter tipos (ex.: texto "2024-05-01T10:00:00" -> objeto datetime);
- gerar a documentação interativa em /api/docs.

Pense neles como um "contrato" entre o frontend e o backend.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Tipos de arquivo aceitos no upload.
ImageContentType = Literal["image/jpeg", "image/png"]


# ---------------------------------------------------------------------------
# Autenticação
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime


# ---------------------------------------------------------------------------
# Álbuns
# ---------------------------------------------------------------------------
class AlbumCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool = False


class AlbumUpdate(BaseModel):
    """Todos os campos são opcionais: só o que for enviado é alterado."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_public: bool | None = None
    cover_photo_id: UUID | None = None


# ---------------------------------------------------------------------------
# EXIF
# Os limites (gt = maior que, lt = menor que) barram valores absurdos que
# poderiam vir de um arquivo corrompido.
# ---------------------------------------------------------------------------
class ExifData(BaseModel):
    camera_make: str | None = Field(default=None, max_length=100)
    camera_model: str | None = Field(default=None, max_length=100)
    lens_model: str | None = Field(default=None, max_length=150)
    focal_length: float | None = Field(default=None, gt=0, lt=10000)  # mm
    aperture: float | None = Field(default=None, gt=0, lt=1000)  # f/
    exposure_time: float | None = Field(default=None, gt=0, lt=100000)  # s
    iso: int | None = Field(default=None, gt=0, lt=10_000_000)
    taken_at: datetime | None = None


# ---------------------------------------------------------------------------
# Fotos
# ---------------------------------------------------------------------------
class UploadUrlRequest(BaseModel):
    """Passo 1 do upload: o navegador pede autorização para enviar."""

    album_id: UUID
    content_type: ImageContentType


class SignedUpload(BaseModel):
    path: str
    signed_url: str
    token: str


class UploadUrlResponse(BaseModel):
    photo_id: UUID
    original: SignedUpload
    thumbnail: SignedUpload


class PhotoCreate(BaseModel):
    """Passo 3 do upload: após enviar os arquivos, o navegador registra a foto."""

    id: UUID
    album_id: UUID
    content_type: ImageContentType
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    width: int | None = Field(default=None, gt=0, lt=100_000)
    height: int | None = Field(default=None, gt=0, lt=100_000)
    file_size: int | None = Field(default=None, ge=0)
    exif: ExifData = Field(default_factory=ExifData)


class PhotoUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
