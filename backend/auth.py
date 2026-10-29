"""
Autenticação simples do proprietário.

Fluxo:
1. O proprietário envia a senha para POST /api/auth/login.
2. Se a senha bater com ADMIN_PASSWORD, o servidor devolve um TOKEN (JWT).
3. O navegador guarda o token e o envia em toda requisição protegida, no
   cabeçalho HTTP:  Authorization: Bearer <token>
4. O servidor verifica a assinatura do token com SECRET_KEY.

O que é um JWT? Um texto com dados (ex.: "expira em tal data") + uma
assinatura digital. Só quem tem a SECRET_KEY consegue gerar uma assinatura
válida; então, se alguém alterar o token, a verificação falha. Isso permite
que o servidor não precise guardar sessões em lugar nenhum, o que é perfeito
para serverless (onde não há memória persistente entre requisições).
"""

import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import get_settings

JWT_ALGORITHM = "HS256"

# HTTPBearer lê o cabeçalho "Authorization: Bearer ...".
# auto_error=False: se o cabeçalho não existir, devolve None em vez de erro,
# porque várias rotas são públicas e só mudam o comportamento se houver login.
bearer_scheme = HTTPBearer(auto_error=False)


def check_password(candidate: str) -> bool:
    """
    Compara a senha digitada com a senha configurada.

    hmac.compare_digest leva sempre o mesmo tempo, acertando ou errando.
    Uma comparação comum (==) para no primeiro caractere diferente, e um
    atacante poderia medir o tempo de resposta para adivinhar a senha.
    """
    expected = get_settings().admin_password
    return hmac.compare_digest(
        candidate.encode("utf-8"), expected.encode("utf-8")
    )


def create_access_token() -> tuple[str, datetime]:
    """Gera um token assinado e devolve (token, data_de_expiração)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=settings.token_expire_hours)
    payload = {
        "sub": "owner",  # "subject": quem é o dono do token
        "iat": now,  # "issued at": quando foi emitido
        "exp": expires_at,  # "expiration": PyJWT recusa tokens vencidos
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)
    return token, expires_at


def _is_valid_token(token: str) -> bool:
    """Verifica assinatura e validade do token. Nunca lança exceção."""
    try:
        jwt.decode(
            token, get_settings().secret_key, algorithms=[JWT_ALGORITHM]
        )
        return True
    except jwt.PyJWTError:
        return False


# ---------------------------------------------------------------------------
# "Dependências" do FastAPI
# Uma dependência é uma função que o FastAPI executa ANTES da rota e cujo
# resultado é injetado como parâmetro. Ex.:
#     def minha_rota(admin: bool = Depends(is_admin)): ...
# ---------------------------------------------------------------------------
def is_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> bool:
    """Retorna True se a requisição tem um token válido; False caso contrário."""
    if credentials is None:
        return False
    return _is_valid_token(credentials.credentials)


def require_admin(admin: bool = Depends(is_admin)) -> None:
    """Bloqueia a rota (erro 401) se o visitante não estiver logado."""
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária.",
            headers={"WWW-Authenticate": "Bearer"},
        )
