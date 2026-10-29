"""
Conexão com o Supabase (banco de dados + storage).

Por que usar o cliente "supabase" e não uma conexão PostgreSQL direta?
- Funções serverless ligam e desligam o tempo todo. Conexões diretas ao
  PostgreSQL (psycopg) são "caras" de abrir e podem esgotar o limite de
  conexões do banco.
- O cliente supabase conversa com o banco por HTTP (API REST chamada
  PostgREST), que é leve e ideal para serverless.
"""

from functools import lru_cache

from supabase import Client, create_client

from backend.config import get_settings


@lru_cache
def get_supabase() -> Client:
    """
    Cria o cliente Supabase uma única vez por instância da função.

    Usamos a chave "service_role", que tem acesso total. Por isso este
    código só roda no servidor; o navegador nunca vê essa chave.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)
