# Galeria de Fotos Pessoal

Acervo fotográfico pessoal no estilo Flickr: álbuns públicos ou privados, extração automática de EXIF e hospedagem na Vercel, com o Supabase cuidando do banco e dos arquivos.

## 1. Arquitetura

```
                ┌──────────────────────── Vercel ────────────────────────┐
 Navegador ───► │  /            → public/ (HTML/CSS/JS, servido pela CDN)│
                │  /api/*       → api/index.py → FastAPI (backend/)      │
                └───────────────────────────────┬────────────────────────┘
                                                │ chave service_role
                                                ▼
                ┌─────────────────────── Supabase ───────────────────────┐
 Navegador ───► │  Storage (bucket privado "photos")  ← upload direto    │
  (PUT/GET com  │  PostgreSQL (tabelas albums, photos)                   │
   URL assinada)└────────────────────────────────────────────────────────┘
```

**Fluxo de upload (3 passos):**

1. O navegador lê o EXIF e gera uma miniatura de cerca de 800 px.
2. Ele chama `POST /api/photos/upload-url`, e o backend devolve URLs de upload assinadas.
3. O navegador envia o original e a miniatura **direto para o Supabase** (`PUT`).
4. Ele chama `POST /api/photos` com o EXIF e as dimensões, e o backend grava a linha no banco.

**Fluxo de visualização:** o backend consulta o banco, filtra por visibilidade e devolve **URLs temporárias** (assinadas) apenas para as fotos que o visitante pode ver.

### Decisão: EXIF no frontend (JavaScript)

| Critério | Backend (Pillow/exifread) | Frontend (exifr) ✅ |
|---|---|---|
| Limite de 4,5 MB por requisição na Vercel | ❌ Uma foto de 24 MP da T6i passa disso, e o upload falharia | ✅ O arquivo nunca passa pela Vercel |
| Tempo e memória da função serverless | ❌ Ler 15 MB e processar a imagem consome a cota | ✅ Custo zero no servidor |
| Miniatura | ❌ Precisaria do Pillow (pacote pesado, cold start lento) | ✅ Gerada com `<canvas>` no navegador |
| Confiabilidade | ✅ Os dados vêm do servidor | ⚠️ Os dados vêm do cliente, então o backend **valida** cada campo (`schemas.py`) |

Como só o proprietário (logado) envia fotos, confiar nos dados do cliente com validação é seguro. Por isso a extração fica no navegador, e o backend apenas valida e formata, por exemplo convertendo `0.004` em `"1/250"` (veja `backend/exif.py`).

### Segurança

- **Login:** a senha fica na variável `ADMIN_PASSWORD`. O login devolve um JWT assinado com `SECRET_KEY`, válido por 7 dias.
- **Banco:** o RLS está ativado e não há políticas, então a chave pública do Supabase não acessa nada. Somente o backend, com a chave `service_role`, lê e escreve.
- **Arquivos:** o bucket é privado, e os links expiram em 1 hora. Fotos de álbuns privados nunca recebem link para visitantes.
- **Álbum privado acessado sem login:** responde 404, para não revelar que o álbum existe.

## 2. Estrutura de pastas

```
projeto-site-fotos/
├── api/
│   └── index.py            # Entrada da função serverless (só importa o app)
├── backend/                # Código real da API (FastAPI)
│   ├── main.py             # Cria o app e registra as rotas
│   ├── config.py           # Lê as variáveis de ambiente
│   ├── database.py         # Cliente Supabase
│   ├── auth.py             # Senha, JWT e dependências de login
│   ├── storage.py          # URLs assinadas, caminhos e exclusão de arquivos
│   ├── exif.py             # Limpeza e formatação do EXIF
│   ├── schemas.py          # Validação dos dados de entrada (Pydantic)
│   ├── serializers.py      # Formato do JSON de resposta
│   └── routers/
│       ├── auth.py         # /api/auth/*
│       ├── albums.py       # /api/albums/*
│       └── photos.py       # /api/photos/*
├── public/                 # Frontend (servido pela CDN da Vercel)
│   ├── index.html          # Lista de álbuns
│   ├── album.html          # Grade de fotos + visualizador com EXIF
│   ├── admin.html          # Login, álbuns, upload e gerenciamento
│   ├── css/style.css       # Todo o visual (variáveis no topo)
│   └── js/
│       ├── common.js       # api(), login, el(), formatadores, menu
│       ├── home.js         # Página inicial
│       ├── album.js        # Grade e visualizador
│       ├── upload.js       # EXIF, miniatura e envio ao Storage
│       └── admin.js        # Painel do proprietário
├── supabase/
│   └── schema.sql          # Tabelas, segurança e bucket
├── .env.example            # Modelo das variáveis de ambiente
├── requirements.txt        # Dependências de produção (Vercel)
├── requirements-dev.txt    # Dependências locais (uvicorn, dotenv)
└── vercel.json             # Configuração da Vercel (pasta do frontend)
```

## 3. Rotas da API

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/health` | público | Verifica se a API está no ar |
| POST | `/api/auth/login` | público | Recebe `{password}` e devolve `{token, expires_at}` |
| GET | `/api/auth/me` | público | Devolve `{authenticated: true/false}` |
| GET | `/api/albums` | público* | Lista os álbuns (*privados só com login) |
| GET | `/api/albums/{slug}` | público* | Devolve o álbum com as fotos, URLs e EXIF |
| POST | `/api/albums` | 🔒 | Cria um álbum |
| PATCH | `/api/albums/{id}` | 🔒 | Edita título, descrição, `is_public` ou capa |
| DELETE | `/api/albums/{id}` | 🔒 | Apaga o álbum, as fotos e os arquivos |
| POST | `/api/photos/upload-url` | 🔒 | Passo 1 do upload |
| POST | `/api/photos` | 🔒 | Passo 3 do upload (registra a foto e o EXIF) |
| GET | `/api/photos/{id}` | público* | Devolve a foto em resolução total com o EXIF |
| PATCH | `/api/photos/{id}` | 🔒 | Edita título e descrição |
| DELETE | `/api/photos/{id}` | 🔒 | Apaga a foto |

## 4. Configuração local (Windows / PowerShell)

### 4.1 Instalar o Python

Baixe o **Python 3.12** em https://www.python.org/downloads/. No instalador, marque **"Add python.exe to PATH"**. Depois, feche e reabra o terminal e confira:

```powershell
python --version
```

### 4.2 Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e clique em **New project**.
2. Abra **SQL Editor** > **New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings** > **API**, copie a **Project URL** e a chave **service_role** (*secret*).

### 4.3 Ambiente virtual e dependências

Na pasta do projeto, rode:

> Se `python --version` abrir a Microsoft Store, use o inicializador `py`
> no lugar de `python` só neste primeiro comando (ex.: `py -m venv .venv`).
> Com o ambiente virtual ativado, `python` passa a funcionar normalmente.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
```

> Se o PowerShell bloquear o `Activate.ps1`, rode uma única vez:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 4.4 Variáveis de ambiente

```powershell
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Abra o `.env` e preencha `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e `ADMIN_PASSWORD`. Em `SECRET_KEY`, cole o valor gerado pelo segundo comando.

### 4.5 Rodar e testar

```powershell
uvicorn backend.main:app --reload
```

Abra http://127.0.0.1:8000/api/docs e siga estes passos:

1. Em `POST /api/auth/login`, clique em **Try it out**, envie `{"password": "sua-senha"}` e copie o `token` da resposta.
2. Clique em **Authorize** (cadeado no topo da página), cole o token e confirme.
3. Em `POST /api/albums`, crie um álbum com `{"title": "Teste", "is_public": true}`.
4. Em `GET /api/albums`, confirme que o álbum aparece.

Com o servidor rodando, o site completo fica em http://127.0.0.1:8000. Para testar o upload e publicar na Vercel, siga o [DEPLOY.md](DEPLOY.md).
