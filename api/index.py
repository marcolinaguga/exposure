"""
Ponto de entrada da função serverless na Vercel.

Como a Vercel funciona com Python:
- Todo arquivo .py dentro da pasta "api/" vira uma "função serverless".
- Uma função serverless é um programa que a Vercel liga sob demanda quando
  chega uma requisição, e desliga depois de um tempo sem uso.
- A Vercel reconhece que esta função é um app FastAPI e entrega a ele
  toda URL que não seja um arquivo da pasta "public/" (com o caminho
  original, ex.: /api/auth/login). O FastAPI então decide qual rota
  responde. Por isso o vercel.json NÃO precisa de regras de "rewrites".

Este arquivo é propositalmente minúsculo: ele só importa o "app" que está
no pacote "backend/". Assim o código real fica organizado em vários módulos
e você também consegue rodá-lo localmente sem a Vercel.
"""

import sys
from pathlib import Path

# Garante que a raiz do projeto esteja no "caminho de importação" do Python,
# para que "import backend" funcione tanto na Vercel quanto localmente.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# A Vercel procura uma variável chamada "app" neste arquivo.
from backend.main import app  # noqa: E402,F401  (import após ajuste do path)
