"""
Rotas de autenticação: login e verificação de sessão.
"""

import time

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import check_password, create_access_token, is_admin
from backend.schemas import LoginRequest, LoginResponse

# APIRouter agrupa rotas. O "prefix" é colocado antes de cada caminho:
# @router.post("/login") vira POST /api/auth/login.
router = APIRouter(prefix="/api/auth", tags=["autenticação"])

# Atraso aplicado a cada senha errada. Em serverless não temos memória
# compartilhada para contar tentativas; o atraso já torna ataques de
# "força bruta" (testar milhões de senhas) muito mais lentos.
FAILED_LOGIN_DELAY_SECONDS = 1.0


# Rotas definidas com "def" (e não "async def") rodam em uma thread separada.
# Isso é o correto aqui porque time.sleep e o cliente Supabase são
# "bloqueantes" (esperam a resposta parados).
@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    """Troca a senha do proprietário por um token de acesso."""
    if not check_password(payload.password):
        time.sleep(FAILED_LOGIN_DELAY_SECONDS)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Senha incorreta.",
        )

    token, expires_at = create_access_token()
    return LoginResponse(token=token, expires_at=expires_at)


@router.get("/me")
def me(admin: bool = Depends(is_admin)) -> dict:
    """Permite ao frontend saber se o token guardado ainda é válido."""
    return {"authenticated": admin}
