# Guia de deploy

Este guia leva o projeto do seu computador até um endereço público na Vercel. Os comandos são para o **PowerShell**, executados na pasta do projeto.

**Pré-requisitos:** Supabase configurado (seção 4.2 do README) e arquivo `.env` preenchido (seção 4.4).

---

## Passo 1: Exportar as fotos do Lightroom corretamente

O site lê o EXIF gravado no arquivo exportado. No diálogo **Exportar** do Lightroom, confira:

| Seção | Configuração |
|---|---|
| **Configurações de arquivo** | Formato JPEG, espaço de cor **sRGB**, qualidade 80 a 90 |
| **Dimensionamento da imagem** | Redimensionar para **Borda longa: 3000 px** (recomendado, veja o Passo 8) |
| **Metadados** | **Todos os metadados** ou **Todos exceto informações do Camera Raw** |

⚠️ **Não use** a opção "Todos exceto informações da câmera e do Camera Raw": ela remove justamente câmera, lente, ISO e as demais informações de EXIF.

## Passo 2: Testar tudo localmente

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload
```

Abra http://127.0.0.1:8000 e faça o roteiro abaixo:

1. Clique em **Entrar** (no rodapé) e digite a senha definida em `ADMIN_PASSWORD`.
2. Crie um álbum marcando **Público**.
3. Clique em **Gerenciar** e arraste duas ou três fotos para a área de upload.
4. Clique em **Ver álbum**, abra uma foto e confira o EXIF no painel lateral.
5. Use as setas do teclado para navegar e **Esc** para fechar.
6. Clique em **Sair** e confirme que só os álbuns públicos aparecem.

Para parar o servidor, pressione `Ctrl + C` no terminal.

## Passo 3: Enviar o código para o GitHub

### 3.1 Identificar-se no Git (só na primeira vez)

```powershell
git config --global user.name "Seu Nome"
git config --global user.email "seu-email@exemplo.com"
```

### 3.2 Criar o repositório local e o primeiro commit

```powershell
git init
git add .
git status
git commit -m "Primeira versão da galeria de fotos"
```

Antes do commit, confira a saída do `git status`. **Os itens `.env` e `.venv` não podem aparecer na lista.** O `.gitignore` já os exclui, mas vale conferir, porque o `.env` contém as suas senhas.

### 3.3 Criar o repositório no GitHub

1. Acesse https://github.com/new.
2. Dê um nome, por exemplo `galeria-fotos`, e marque **Private**.
3. **Não** marque nenhuma opção de README, `.gitignore` ou licença.
4. Clique em **Create repository** e copie a URL que aparece (termina em `.git`).

### 3.4 Enviar

```powershell
git remote add origin https://github.com/SEU-USUARIO/galeria-fotos.git
git branch -M main
git push -u origin main
```

Na primeira vez, o Git abrirá uma janela para você entrar na sua conta do GitHub.

## Passo 4: Criar o projeto na Vercel

1. Acesse https://vercel.com e entre com a sua conta do GitHub (**Continue with GitHub**).
2. Clique em **Add New… → Project** e escolha o repositório `galeria-fotos` (**Import**).
3. Na tela de configuração:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./` (padrão)
   - **Build and Output Settings:** não altere nada (o `vercel.json` já define tudo)
4. Abra **Environment Variables** e cadastre cada variável do seu `.env`, uma por vez:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | URL do projeto Supabase |
   | `SUPABASE_SERVICE_KEY` | chave service_role |
   | `STORAGE_BUCKET` | `photos` |
   | `ADMIN_PASSWORD` | sua senha |
   | `SECRET_KEY` | a chave aleatória longa |

   As variáveis `TOKEN_EXPIRE_HOURS` e `SIGNED_URL_EXPIRE_SECONDS` são opcionais.

5. Clique em **Deploy** e aguarde cerca de 1 minuto.

## Passo 5: Testar em produção

A Vercel mostra um endereço como `https://galeria-fotos-xxxx.vercel.app`. Teste nesta ordem:

1. **`/api/health`** deve responder `{"status":"ok"}`. Isso confirma que o Python está rodando.
2. **`/`** deve mostrar a lista de álbuns. Isso confirma o acesso ao banco.
3. **`/admin.html`**: faça login e envie uma foto **grande** (mais de 5 MB). Isso confirma o upload direto para o Supabase.

## Passo 6: Atualizar o site depois

Toda alteração enviada ao GitHub gera um deploy automático:

```powershell
git add .
git commit -m "Descreva aqui o que mudou"
git push
```

Se você alterar uma **variável de ambiente** na Vercel, é preciso fazer um novo deploy para ela valer: abra **Deployments**, clique em **⋯** no último deploy e escolha **Redeploy**.

## Passo 7: Domínio próprio (opcional)

Na Vercel, abra **Project → Settings → Domains → Add** e digite o domínio (ex.: `fotos.seudominio.com.br`). A Vercel mostra o registro DNS (CNAME ou A) que você deve criar no site onde comprou o domínio (Registro.br, por exemplo). O HTTPS é configurado automaticamente.

## Passo 8: Limites dos planos gratuitos

| Serviço | Limite | O que significa na prática |
|---|---|---|
| Supabase Storage | **1 GB** | Com originais de ~12 MB, cabem cerca de **80 fotos**. Exportando com borda longa de 3000 px e qualidade 85 (~2 MB por foto), cabem **400 a 500 fotos**. Acima disso, o plano Pro (US$ 25/mês) oferece 100 GB. |
| Supabase (pausa) | Projeto pausa após **7 dias sem acesso** | O site para de carregar as fotos. Para reativar, clique em **Restore** no painel do Supabase. Visitas frequentes evitam a pausa. |
| Supabase Storage | 50 MB por arquivo | O site já bloqueia arquivos maiores. |
| Vercel Hobby | Uso pessoal e não comercial | Adequado para este projeto. |

Para ver quanto espaço já foi usado, abra **Supabase → Project Settings → Usage**.

## Resolução de problemas

Os erros do backend aparecem na Vercel em **Project → Logs**. No navegador, pressione **F12** e veja as abas **Console** e **Network** (Rede).

| Sintoma | Causa provável | Solução |
|---|---|---|
| `/api/health` responde 500 | Variável de ambiente faltando | Veja em **Logs** a mensagem "Variável de ambiente obrigatória ausente", cadastre a variável e faça **Redeploy** |
| "Erro ao acessar o banco de dados" | `schema.sql` não executado, ou URL/chave erradas | Rode o `schema.sql` de novo e confira as variáveis |
| Upload falha com "Falha no envio ao Storage (400/404)" | Bucket `photos` não existe | Confira em **Supabase → Storage**. Se o bucket não estiver lá, rode o `schema.sql` de novo. |
| Upload falha com 413 | Arquivo maior que o limite do bucket | Exporte com tamanho menor (veja o Passo 1) |
| Fotos sem EXIF | Metadados removidos na exportação | Revise a seção **Metadados** no Passo 1 |
| Imagens somem depois de muito tempo com a página aberta | Os links temporários expiraram (1 hora) | Recarregue a página (F5) |
| "Sua sessão expirou" | O token venceu (7 dias), ou a `SECRET_KEY` foi trocada | Faça login novamente |
| Página `/admin.html` abre, mas a senha nunca funciona | `ADMIN_PASSWORD` diferente na Vercel | Confira a variável e faça **Redeploy** |
