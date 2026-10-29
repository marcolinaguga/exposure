"""
Operações com o Supabase Storage (onde ficam os arquivos das imagens).

Ideia central: os ARQUIVOS NUNCA passam pela Vercel.
- A Vercel limita o corpo de cada requisição a ~4,5 MB. Uma foto da T6i
  (24 MP) exportada do Lightroom em alta qualidade costuma ter 8-15 MB.
- Solução: o backend gera uma "URL de upload assinada" (um link temporário
  que autoriza enviar UM arquivo para UM caminho específico) e o navegador
  envia o arquivo direto para o Supabase.
- Para exibir, o bucket é privado e o backend gera "URLs assinadas" de
  leitura, válidas por tempo limitado, apenas para fotos que o visitante
  tem permissão de ver.
"""

from uuid import UUID

from backend.config import get_settings
from backend.database import get_supabase

# Extensão do arquivo de acordo com o tipo MIME enviado pelo navegador.
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png"}


def _bucket():
    """Atalho para o bucket configurado."""
    return get_supabase().storage.from_(get_settings().storage_bucket)


def build_paths(
    album_id: UUID, photo_id: UUID, content_type: str
) -> tuple[str, str]:
    """
    Define onde os arquivos ficarão dentro do bucket.

    Organizamos por pasta de álbum:  <album_id>/<photo_id>.jpg
    A miniatura (thumbnail) sempre é JPG, gerada no navegador.
    Usar o ID (e não o nome original do arquivo) evita conflitos de nomes
    e problemas com acentos/espaços.
    """
    extension = EXTENSIONS[content_type]
    original = f"{album_id}/{photo_id}.{extension}"
    thumbnail = f"{album_id}/{photo_id}_thumb.jpg"
    return original, thumbnail


def create_upload_slot(path: str) -> dict:
    """
    Cria uma URL de upload assinada para o caminho informado.

    O navegador fará um PUT nessa URL com o arquivo no corpo.
    O Supabase deixa a URL válida por 2 horas.
    """
    result = _bucket().create_signed_upload_url(path)
    # Versões diferentes da biblioteca usam "signed_url" ou "signedUrl".
    signed_url = result.get("signed_url") or result.get("signedUrl")
    return {"path": path, "signed_url": signed_url, "token": result["token"]}


def create_view_urls(paths: list[str]) -> dict[str, str]:
    """
    Gera URLs de leitura temporárias para vários arquivos de uma vez.

    Devolve um dicionário {caminho: url}. Fazer em lote (uma chamada HTTP
    para todos os arquivos) é muito mais rápido do que uma chamada por foto.
    """
    unique_paths = sorted({p for p in paths if p})
    if not unique_paths:
        return {}

    expires_in = get_settings().signed_url_expire_seconds
    results = _bucket().create_signed_urls(unique_paths, expires_in)

    urls = {}
    for item in results:
        url = item.get("signedURL") or item.get("signedUrl")
        if url and item.get("path"):
            urls[item["path"]] = url
    return urls


def delete_files(paths: list[str]) -> None:
    """Apaga arquivos do bucket (em lotes de 100, limite seguro da API)."""
    unique_paths = [p for p in dict.fromkeys(paths) if p]
    for start in range(0, len(unique_paths), 100):
        _bucket().remove(unique_paths[start:start + 100])
