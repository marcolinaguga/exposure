"""
Rotas de fotos.

O UPLOAD acontece em 3 passos, para que o arquivo pesado nunca passe pela
Vercel (limite de ~4,5 MB por requisição):

  1. POST /api/photos/upload-url
     O navegador pede autorização. O backend devolve um ID para a foto e
     duas URLs de upload assinadas (original + miniatura).

  2. PUT <signed_url>   (direto para o Supabase, sem passar pelo backend)
     O navegador envia os arquivos.

  3. POST /api/photos
     O navegador envia os metadados (EXIF já extraído, dimensões etc.)
     e o backend grava a linha no banco.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.auth import is_admin, require_admin
from backend.database import get_supabase
from backend.exif import normalize_exif
from backend.schemas import (
    PhotoCreate,
    PhotoUpdate,
    UploadUrlRequest,
    UploadUrlResponse,
)
from backend.serializers import photo_to_dict
from backend.storage import (
    build_paths,
    create_upload_slot,
    create_view_urls,
    delete_files,
)

router = APIRouter(prefix="/api/photos", tags=["fotos"])

NOT_FOUND = "Foto não encontrada."

# Traz a foto e, na mesma consulta, os dados do álbum ao qual ela pertence.
PHOTO_SELECT = (
    "*, album:albums!photos_album_id_fkey(id, slug, title, is_public)"
)


def _get_photo_or_404(photo_id: UUID) -> dict:
    """Busca a foto junto com dados do álbum (para checar visibilidade)."""
    result = (
        get_supabase()
        .table("photos")
        .select(PHOTO_SELECT)
        .eq("id", str(photo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return result.data[0]


def _ensure_album_exists(album_id: UUID) -> dict:
    result = (
        get_supabase()
        .table("albums")
        .select("id, cover_photo_id")
        .eq("id", str(album_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Álbum não encontrado.")
    return result.data[0]


# ---------------------------------------------------------------------------
# Upload (somente proprietário)
# ---------------------------------------------------------------------------
@router.post(
    "/upload-url",
    response_model=UploadUrlResponse,
    dependencies=[Depends(require_admin)],
)
def request_upload_url(payload: UploadUrlRequest) -> UploadUrlResponse:
    """Passo 1: reserva um ID e devolve as URLs de upload assinadas."""
    _ensure_album_exists(payload.album_id)

    # uuid4() gera um identificador aleatório praticamente impossível de
    # repetir. Ele vira o ID da foto no banco e o nome do arquivo.
    photo_id = uuid4()
    original_path, thumb_path = build_paths(
        payload.album_id, photo_id, payload.content_type
    )

    return UploadUrlResponse(
        photo_id=photo_id,
        original=create_upload_slot(original_path),
        thumbnail=create_upload_slot(thumb_path),
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def register_photo(payload: PhotoCreate) -> dict:
    """Passo 3: grava no banco a foto já enviada ao Storage."""
    album = _ensure_album_exists(payload.album_id)
    db = get_supabase()

    # Os caminhos são recalculados AQUI a partir dos IDs, em vez de aceitar
    # caminhos vindos do navegador. Assim ninguém consegue apontar uma foto
    # para um arquivo arbitrário do bucket.
    storage_path, thumb_path = build_paths(
        payload.album_id, payload.id, payload.content_type
    )

    row = {
        "id": str(payload.id),
        "album_id": str(payload.album_id),
        "storage_path": storage_path,
        "thumb_path": thumb_path,
        "title": payload.title,
        "description": payload.description,
        "width": payload.width,
        "height": payload.height,
        "file_size": payload.file_size,
        # O operador ** "espalha" o dicionário do EXIF dentro deste.
        **normalize_exif(payload.exif),
    }

    inserted = db.table("photos").insert(row).execute().data[0]

    # A primeira foto enviada vira a capa do álbum automaticamente.
    if album["cover_photo_id"] is None:
        db.table("albums").update({"cover_photo_id": inserted["id"]}).eq(
            "id", str(payload.album_id)
        ).execute()

    urls = create_view_urls([storage_path, thumb_path])
    return photo_to_dict(inserted, urls)


# ---------------------------------------------------------------------------
# Leitura (respeita a visibilidade do álbum)
# ---------------------------------------------------------------------------
@router.get("/{photo_id}")
def get_photo(photo_id: UUID, admin: bool = Depends(is_admin)) -> dict:
    """Devolve uma foto com EXIF e URL em resolução total."""
    row = _get_photo_or_404(photo_id)
    album = row.get("album") or {}

    if not album.get("is_public") and not admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)

    urls = create_view_urls([row["storage_path"], row["thumb_path"]])
    response = photo_to_dict(row, urls)
    response["album"] = {
        "slug": album.get("slug"),
        "title": album.get("title"),
    }
    return response


# ---------------------------------------------------------------------------
# Edição e exclusão (somente proprietário)
# ---------------------------------------------------------------------------
@router.patch("/{photo_id}", dependencies=[Depends(require_admin)])
def update_photo(photo_id: UUID, payload: PhotoUpdate) -> dict:
    """Altera título e/ou descrição de uma foto."""
    row = _get_photo_or_404(photo_id)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Nenhum campo para alterar."
        )

    updated = (
        get_supabase()
        .table("photos")
        .update(changes)
        .eq("id", str(photo_id))
        .execute()
        .data[0]
    )
    urls = create_view_urls([row["storage_path"], row["thumb_path"]])
    return photo_to_dict(updated, urls)


@router.delete(
    "/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def delete_photo(photo_id: UUID) -> Response:
    """Apaga a foto (arquivos + linha) e escolhe nova capa se necessário."""
    row = _get_photo_or_404(photo_id)
    db = get_supabase()

    delete_files([row["storage_path"], row["thumb_path"]])
    db.table("photos").delete().eq("id", str(photo_id)).execute()

    # Se era a capa, o banco já zerou cover_photo_id (on delete set null).
    # Escolhemos então a foto mais recente restante como nova capa.
    album = (
        db.table("albums")
        .select("id, cover_photo_id")
        .eq("id", row["album_id"])
        .execute()
        .data
    )
    if album and album[0]["cover_photo_id"] is None:
        remaining = (
            db.table("photos")
            .select("id")
            .eq("album_id", row["album_id"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        if remaining:
            db.table("albums").update(
                {"cover_photo_id": remaining[0]["id"]}
            ).eq("id", row["album_id"]).execute()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
