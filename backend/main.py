"""
Aplicação FastAPI principal: junta todas as rotas em um único "app".

Para rodar localmente (com o ambiente virtual ativado):
    uvicorn backend.main:app --reload

Depois abra http://127.0.0.1:8000/api/docs para testar a API pelo navegador.
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from postgrest.exceptions import APIError

from backend.routers import albums, auth, photos

logger = logging.getLogger("galeria")

app = FastAPI(
    title="Galeria de Fotos",
    description="API do acervo fotográfico pessoal.",
    version="1.0.0",
    # A documentação fica sob /api para passar pelo mesmo redirecionamento
    # da Vercel que as demais rotas.
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

# Registra os grupos de rotas.
app.include_router(auth.router)
app.include_router(albums.router)
app.include_router(photos.router)


@app.get("/api/health", tags=["sistema"])
def health() -> dict:
    """Rota simples para verificar se a API está no ar."""
    return {"status": "ok"}


@app.exception_handler(APIError)
def handle_database_error(request: Request, exc: APIError) -> JSONResponse:
    """
    Erros vindos do banco (PostgREST) viram uma resposta JSON padronizada.

    Os detalhes vão para o log (visível no painel da Vercel em "Logs"),
    mas não são mostrados ao visitante, pois podem revelar a estrutura
    interna do banco.
    """
    logger.error("Erro no banco em %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=502,
        content={"detail": "Erro ao acessar o banco de dados."},
    )


# ---------------------------------------------------------------------------
# Arquivos do frontend (somente em desenvolvimento local)
# Na Vercel, a pasta "public/" é servida pela CDN da própria plataforma
# (mais rápido e não consome a função Python). A Vercel define a variável
# de ambiente VERCEL=1; localmente ela não existe, então servimos os
# arquivos por aqui para que tudo funcione em http://127.0.0.1:8000.
# Esta montagem precisa vir DEPOIS das rotas da API, pois "/" captura tudo.
# ---------------------------------------------------------------------------
PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

if PUBLIC_DIR.is_dir() and not os.environ.get("VERCEL"):
    app.mount(
        "/", StaticFiles(directory=PUBLIC_DIR, html=True), name="frontend"
    )
