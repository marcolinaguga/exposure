/*
 * common.js — código compartilhado por TODAS as páginas.
 *
 * Contém:
 *   - Auth: guarda e lê o token de login no navegador;
 *   - api(): função única para conversar com o backend;
 *   - el(): atalho para criar elementos HTML com segurança;
 *   - formatadores de EXIF, datas e tamanhos;
 *   - renderNav(): monta o menu do cabeçalho.
 *
 * Este arquivo é carregado ANTES do script específico de cada página
 * (veja a ordem das tags <script> no HTML), por isso as funções daqui
 * ficam disponíveis para os outros arquivos.
 */

"use strict";


/* ==========================================================================
   AUTENTICAÇÃO
   O token recebido no login fica no "localStorage": um pequeno espaço de
   armazenamento do navegador que sobrevive ao fechar a aba. Cada site tem
   o seu, e outros sites não conseguem lê-lo.
   ========================================================================== */
const TOKEN_KEY = "galeria_token";

const Auth = {
    getToken() {
        // try/catch: em janelas anônimas de alguns navegadores o
        // localStorage pode estar bloqueado e lançar erro.
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch {
            return null;
        }
    },

    setToken(token) {
        localStorage.setItem(TOKEN_KEY, token);
    },

    clear() {
        try {
            localStorage.removeItem(TOKEN_KEY);
        } catch {
            /* nada a fazer */
        }
    },

    /*
     * Verifica se existe um token AINDA NÃO VENCIDO.
     * Um JWT tem três partes separadas por ponto: cabeçalho.dados.assinatura
     * A parte do meio é JSON codificado em base64; lemos dali o campo "exp"
     * (data de expiração, em segundos). Isso é só uma conveniência para o
     * menu: quem garante a segurança de verdade é o backend.
     */
    isLoggedIn() {
        const token = this.getToken();
        if (!token) {
            return false;
        }
        try {
            const base64 = token.split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/");
            const payload = JSON.parse(atob(base64));
            if (payload.exp * 1000 > Date.now()) {
                return true;
            }
        } catch {
            /* token malformado: cai no clear() abaixo */
        }
        this.clear();
        return false;
    },
};


/* ==========================================================================
   COMUNICAÇÃO COM O BACKEND
   ========================================================================== */

/** Erro com o código HTTP junto, para o código saber o que aconteceu. */
class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/**
 * Transforma a resposta de erro do FastAPI em uma frase legível.
 * O FastAPI responde {"detail": "texto"} ou, em erros de validação (422),
 * {"detail": [{"loc": [...], "msg": "..."}]}.
 */
function errorMessageFrom(data, status) {
    if (data && typeof data.detail === "string") {
        return data.detail;
    }
    if (data && Array.isArray(data.detail) && data.detail.length) {
        const first = data.detail[0];
        const field = (first.loc || []).slice(1).join(".");
        return field ? `${field}: ${first.msg}` : first.msg;
    }
    return `Erro inesperado (código ${status}).`;
}

/**
 * Faz uma requisição à API e devolve o JSON da resposta.
 *
 * Exemplos de uso:
 *   const albuns = await api("/albums");
 *   await api("/albums", { method: "POST", body: { title: "Férias" } });
 *
 * "async/await": fetch() não devolve a resposta na hora, devolve uma
 * "promessa" (Promise). O "await" pausa a função até a resposta chegar,
 * sem travar a página.
 */
async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    const token = Auth.getToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    // Página aberta com duplo clique no arquivo (file://): não há servidor
    // por trás, então nenhuma chamada à API pode funcionar.
    if (window.location.protocol === "file:") {
        throw new ApiError(
            "Abra o site pelo servidor (http://127.0.0.1:8000), não pelo arquivo.",
            0,
        );
    }

    let response;
    try {
        response = await fetch(`/api${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        // fetch() só lança erro quando NÃO conseguiu falar com o servidor
        // (desligado, sem internet...). Erros HTTP como 401 não caem aqui.
        throw new ApiError(
            "Não foi possível conectar ao servidor. Verifique se ele está rodando.",
            0,
        );
    }

    // Token vencido ou inválido: descarta para não reenviá-lo.
    if (response.status === 401 && token) {
        Auth.clear();
    }

    // 204 = "sem conteúdo" (ex.: após apagar algo).
    if (response.status === 204) {
        return null;
    }

    // .catch(() => null): se a resposta não for JSON, não quebra.
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new ApiError(errorMessageFrom(data, response.status), response.status);
    }
    return data;
}


/* ==========================================================================
   CRIAÇÃO DE ELEMENTOS HTML
   Usamos textContent (nunca innerHTML com dados da API). Se um título
   contivesse "<script>", innerHTML o executaria; textContent apenas o
   mostra como texto. Isso evita a falha de segurança chamada XSS.
   ========================================================================== */

/**
 * Cria um elemento HTML.
 *
 *   el("a", { href: "/", class: "link", text: "Início" })
 *   el("div", { class: "card" }, [filho1, filho2])
 *
 * Propriedades especiais:
 *   text    -> conteúdo de texto
 *   class   -> classes CSS
 *   style   -> objeto com propriedades CSS (aceita variáveis "--w")
 *   onclick -> qualquer "on..." vira um ouvinte de evento
 */
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) {
            continue;
        }
        if (key === "text") {
            node.textContent = value;
        } else if (key === "class") {
            node.className = value;
        } else if (key === "style") {
            for (const [prop, propValue] of Object.entries(value)) {
                node.style.setProperty(prop, propValue);
            }
        } else if (key.startsWith("on") && typeof value === "function") {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else {
            node.setAttribute(key, value === true ? "" : value);
        }
    }

    // [].concat aceita tanto um único filho quanto uma lista.
    for (const child of [].concat(children)) {
        if (child !== null && child !== undefined && child !== false) {
            node.append(child); // strings viram texto automaticamente
        }
    }
    return node;
}


/* ==========================================================================
   FORMATADORES
   ========================================================================== */

/** "1 foto" / "3 fotos" */
function pluralize(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/** 15728640 -> "15,0 MB" */
function formatBytes(bytes) {
    if (!bytes) {
        return null;
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/** "2024-03-12T14:32:00+00:00" -> "12 de mar. de 2024, 14:32" */
function formatDate(isoText) {
    if (!isoText) {
        return null;
    }
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}

/** 1.8 -> "1,8" (vírgula decimal brasileira, sem zeros sobrando) */
function formatNumber(value) {
    return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/**
 * Converte o objeto "exif" da API em uma lista de pares [rótulo, valor],
 * já formatados para exibição. Campos vazios são omitidos.
 */
function exifRows(exif = {}) {
    const camera = [exif.camera_make, exif.camera_model].filter(Boolean).join(" ");
    const rows = [
        ["Câmera", camera || null],
        ["Lente", exif.lens_model],
        ["Distância focal", exif.focal_length ? `${formatNumber(exif.focal_length)} mm` : null],
        ["Abertura", exif.aperture ? `ƒ/${formatNumber(exif.aperture)}` : null],
        ["Velocidade", exif.shutter_speed ? `${exif.shutter_speed} s` : null],
        ["ISO", exif.iso],
        ["Data", formatDate(exif.taken_at)],
    ];
    return rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
}


/* ==========================================================================
   MENU DO CABEÇALHO
   Cada página tem <nav id="site-nav"></nav>; aqui preenchemos os links
   de acordo com o estado do login.
   ========================================================================== */
function renderNav() {
    const nav = document.getElementById("site-nav");
    if (!nav) {
        return;
    }

    // A logo já leva à página inicial; o menu só aponta para os álbuns.
    const links = [el("a", { href: "index.html#albuns", text: "Álbuns" })];

    if (Auth.isLoggedIn()) {
        links.push(el("a", { href: "admin.html", text: "Gerenciar" }));
        links.push(el("button", {
            type: "button",
            text: "Sair",
            onclick: () => {
                Auth.clear();
                window.location.href = "index.html";
            },
        }));
    }

    nav.replaceChildren(...links);
}

// Monta o menu assim que o HTML terminar de carregar.
document.addEventListener("DOMContentLoaded", renderNav);
