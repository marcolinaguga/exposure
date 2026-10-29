"""
Funções que montam o JSON de resposta a partir das linhas do banco.

Separar isto das rotas evita repetir o mesmo código em vários lugares e
garante que o frontend sempre receba fotos e álbuns no mesmo formato.
"""

# Campos de EXIF que o frontend exibirá na visão detalhada.
EXIF_FIELDS = (
    "camera_make",
    "camera_model",
    "lens_model",
    "focal_length",
    "aperture",
    "exposure_time",
    "shutter_speed",
    "iso",
    "taken_at",
)


def photo_to_dict(row: dict, urls: dict[str, str]) -> dict:
    """
    Converte uma linha da tabela "photos" no JSON enviado ao navegador.

    "urls" é o dicionário {caminho_no_storage: url_assinada} gerado por
    storage.create_view_urls(). Os caminhos internos do bucket não são
    expostos; o navegador só recebe as URLs temporárias.
    """
    return {
        "id": row["id"],
        "album_id": row["album_id"],
        "title": row.get("title"),
        "description": row.get("description"),
        "width": row.get("width"),
        "height": row.get("height"),
        "file_size": row.get("file_size"),
        "created_at": row.get("created_at"),
        "url": urls.get(row["storage_path"]),
        "thumb_url": urls.get(row["thumb_path"]),
        "exif": {field: row.get(field) for field in EXIF_FIELDS},
    }


def album_to_dict(row: dict, urls: dict[str, str]) -> dict:
    """
    Converte uma linha da tabela "albums" no JSON enviado ao navegador.

    As chaves "cover" e "photo_count" só existem quando a consulta pede
    esses dados relacionados (veja routers/albums.py).
    """
    cover = row.get("cover") or {}

    # O PostgREST devolve contagens como [{"count": N}].
    count_data = row.get("photo_count") or [{"count": 0}]
    photo_count = count_data[0].get("count", 0) if count_data else 0

    return {
        "id": row["id"],
        "title": row["title"],
        "slug": row["slug"],
        "description": row.get("description"),
        "is_public": row["is_public"],
        "cover_photo_id": row.get("cover_photo_id"),
        "cover_url": urls.get(cover.get("thumb_path", "")),
        "photo_count": photo_count,
        "created_at": row.get("created_at"),
    }
