"""
Rotas de álbuns.

Regras de visibilidade:
- Visitante (sem login): vê apenas álbuns com is_public = true.
- Proprietário (com login): vê todos e pode criar, editar e apagar.
- Um álbum privado acessado por visitante responde 404 ("não encontrado")
  em vez de 403 ("proibido"), para não revelar que ele existe.
"""

import re
import secrets
import unicodedata
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.auth import is_admin, require_admin
from backend.database import get_supabase
from backend.schemas import AlbumCreate, AlbumUpdate
from backend.serializers import album_to_dict, photo_to_dict
from backend.storage import create_view_urls, delete_files

router = APIRouter(prefix="/api/albums", tags=["álbuns"])

# Consulta usada na listagem. A sintaxe "apelido:tabela!restrição(colunas)"
# do PostgREST traz dados de outra tabela na mesma requisição (como um JOIN):
# - cover: a foto de capa (usando a chave estrangeira cover_photo_id);
# - photo_count: quantas fotos o álbum tem.
# O "!nome_da_restrição" é necessário porque há DUAS ligações entre as
# tabelas (capa e album_id) e o PostgREST precisa saber qual usar.
ALBUM_LIST_SELECT = (
    "*, "
    "cover:photos!albums_cover_photo_id_fkey(thumb_path), "
    "photo_count:photos!photos_album_id_fkey(count)"
)

NOT_FOUND = "Álbum não encontrado."


def slugify(text: str) -> str:
    """
    Gera um identificador amigável para URLs.

    "Viagem à Chapada (2024)" -> "viagem-a-chapada-2024"
    1. NFKD separa letras dos acentos ("à" vira "a" + "`").
    2. encode("ascii", "ignore") descarta os acentos.
    3. A expressão regular troca tudo que não é letra/número por "-".
    """
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text).strip("-").lower()
    return slug[:60] or "album"


def _unique_slug(title: str) -> str:
    """Garante que o slug não exista ainda, adicionando um sufixo se preciso."""
    db = get_supabase()
    base = slugify(title)
    slug = base
    while db.table("albums").select("id").eq("slug", slug).execute().data:
        slug = f"{base}-{secrets.token_hex(2)}"  # ex.: "ferias-3fa9"
    return slug


def _get_album_or_404(album_id: UUID) -> dict:
    result = (
        get_supabase()
        .table("albums")
        .select("*")
        .eq("id", str(album_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return result.data[0]


# ---------------------------------------------------------------------------
# Leitura (pública, com filtro de visibilidade)
# ---------------------------------------------------------------------------
@router.get("")
def list_albums(admin: bool = Depends(is_admin)) -> list[dict]:
    """Lista os álbuns visíveis, com capa e número de fotos."""
    query = (
        get_supabase()
        .table("albums")
        .select(ALBUM_LIST_SELECT)
        .order("created_at", desc=True)
    )
    if not admin:
        query = query.eq("is_public", True)

    rows = query.execute().data

    # Gera as URLs das capas em uma única chamada ao Storage.
    cover_paths = [(r.get("cover") or {}).get("thumb_path") for r in rows]
    urls = create_view_urls(cover_paths)

    return [album_to_dict(row, urls) for row in rows]


@router.get("/{slug}")
def get_album(slug: str, admin: bool = Depends(is_admin)) -> dict:
    """Devolve um álbum e todas as suas fotos (com URLs temporárias)."""
    db = get_supabase()
    result = (
        db.table("albums")
        .select(ALBUM_LIST_SELECT)
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)

    album = result.data[0]
    if not album["is_public"] and not admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)

    photos = (
        db.table("photos").select("*").eq("album_id", album["id"]).execute()
    ).data

    # Ordena cronologicamente pela data em que a foto foi TIRADA (EXIF);
    # se não houver, usa a data de upload. Datas ISO em texto podem ser
    # comparadas diretamente, pois a ordem alfabética coincide com a temporal.
    photos.sort(key=lambda p: p.get("taken_at") or p["created_at"])

    paths = [p["storage_path"] for p in photos] + [
        p["thumb_path"] for p in photos
    ]
    paths.append((album.get("cover") or {}).get("thumb_path"))
    urls = create_view_urls(paths)

    response = album_to_dict(album, urls)
    response["photos"] = [photo_to_dict(p, urls) for p in photos]
    return response


# ---------------------------------------------------------------------------
# Escrita (somente proprietário)
# dependencies=[Depends(require_admin)] bloqueia a rota sem login válido.
# ---------------------------------------------------------------------------
@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_album(payload: AlbumCreate) -> dict:
    """Cria um novo álbum (privado por padrão)."""
    data = {
        "title": payload.title.strip(),
        "slug": _unique_slug(payload.title),
        "description": payload.description,
        "is_public": payload.is_public,
    }
    row = get_supabase().table("albums").insert(data).execute().data[0]
    return album_to_dict(row, {})


@router.patch("/{album_id}", dependencies=[Depends(require_admin)])
def update_album(album_id: UUID, payload: AlbumUpdate) -> dict:
    """
    Altera título, descrição, visibilidade ou capa.

    O slug NÃO muda ao renomear, para não quebrar links já compartilhados.
    """
    _get_album_or_404(album_id)
    db = get_supabase()

    # exclude_unset=True: só os campos que o navegador realmente enviou.
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Nenhum campo para alterar."
        )

    if changes.get("title") is not None:
        changes["title"] = changes["title"].strip()

    if changes.get("cover_photo_id") is not None:
        cover_id = str(changes["cover_photo_id"])
        belongs = (
            db.table("photos")
            .select("id")
            .eq("id", cover_id)
            .eq("album_id", str(album_id))
            .execute()
            .data
        )
        if not belongs:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "A foto de capa precisa pertencer a este álbum.",
            )
        changes["cover_photo_id"] = cover_id

    row = (
        db.table("albums")
        .update(changes)
        .eq("id", str(album_id))
        .execute()
        .data[0]
    )
    return album_to_dict(row, {})


@router.delete(
    "/{album_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
def delete_album(album_id: UUID) -> Response:
    """Apaga o álbum, as linhas das fotos e os arquivos no Storage."""
    _get_album_or_404(album_id)
    db = get_supabase()

    photos = (
        db.table("photos")
        .select("storage_path, thumb_path")
        .eq("album_id", str(album_id))
        .execute()
        .data
    )

    # Primeiro os arquivos; depois o álbum (o "on delete cascade" do banco
    # apaga as linhas das fotos automaticamente).
    delete_files(
        [p["storage_path"] for p in photos] + [p["thumb_path"] for p in photos]
    )
    db.table("albums").delete().eq("id", str(album_id)).execute()

    # 204 = sucesso sem conteúdo na resposta.
    return Response(status_code=status.HTTP_204_NO_CONTENT)
