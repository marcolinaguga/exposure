"""
Configurações da aplicação, lidas de VARIÁVEIS DE AMBIENTE.

Por que variáveis de ambiente?
- Senhas e chaves nunca devem ficar escritas no código (que vai para o
  GitHub). Elas ficam no arquivo .env (local) ou no painel da Vercel.
- O mesmo código roda em lugares diferentes só trocando as variáveis.
"""

import os
from dataclasses import dataclass
from functools import lru_cache

# Localmente, o pacote python-dotenv lê o arquivo .env e coloca os valores
# em os.environ. Na Vercel ele não está instalado (e nem é necessário,
# pois a própria plataforma injeta as variáveis), então ignoramos o erro.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


@dataclass(frozen=True)
class Settings:
    """Agrupa todas as configurações em um único objeto imutável."""

    supabase_url: str
    supabase_service_key: str
    storage_bucket: str
    admin_password: str
    secret_key: str
    token_expire_hours: int
    signed_url_expire_seconds: int


def _required(name: str) -> str:
    """Lê uma variável obrigatória; se faltar, falha com mensagem clara."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Variável de ambiente obrigatória ausente: {name}. "
            "Confira o arquivo .env (local) ou o painel da Vercel."
        )
    return value


@lru_cache
def get_settings() -> Settings:
    """
    Monta o objeto Settings.

    O decorador @lru_cache faz a função executar só UMA vez: nas chamadas
    seguintes ele devolve o mesmo resultado guardado em memória.
    """
    secret_key = _required("SECRET_KEY")
    if len(secret_key) < 32:
        raise RuntimeError("SECRET_KEY deve ter pelo menos 32 caracteres.")

    return Settings(
        supabase_url=_required("SUPABASE_URL"),
        supabase_service_key=_required("SUPABASE_SERVICE_KEY"),
        storage_bucket=os.environ.get("STORAGE_BUCKET", "photos"),
        admin_password=_required("ADMIN_PASSWORD"),
        secret_key=secret_key,
        token_expire_hours=int(os.environ.get("TOKEN_EXPIRE_HOURS", "168")),
        signed_url_expire_seconds=int(
            os.environ.get("SIGNED_URL_EXPIRE_SECONDS", "3600")
        ),
    )
