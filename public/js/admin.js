/*
 * admin.js — área do proprietário.
 *
 * Fluxo da página:
 *   1. Sem login válido -> mostra o formulário de senha.
 *   2. Com login -> mostra o painel: criar álbum, listar álbuns,
 *      enviar fotos e gerenciar as fotos do álbum selecionado.
 *
 * Depende de common.js (api, Auth, el...) e upload.js (uploadPhoto).
 */

"use strict";

const $ = (id) => document.getElementById(id);

const state = {
    albums: [], // todos os álbuns (públicos e privados)
    current: null, // álbum selecionado, com a lista de fotos
    uploading: 0, // quantos envios estão em andamento
};


/* ==========================================================================
   LOGIN / LOGOUT
   ========================================================================== */
function showLogin(message = "") {
    $("panel-section").hidden = true;
    $("login-section").hidden = false;
    $("login-message").textContent = message;
    renderNav();
}

function showPanel() {
    $("login-section").hidden = true;
    $("panel-section").hidden = false;
    renderNav();
    loadAlbums();
}

async function handleLogin(event) {
    // Por padrão, enviar um <form> recarrega a página. preventDefault()
    // impede isso para tratarmos o envio aqui com JavaScript.
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector("button");
    const password = new FormData(form).get("password");

    button.disabled = true;
    $("login-message").textContent = "";
    try {
        const result = await api("/auth/login", { method: "POST", body: { password } });
        Auth.setToken(result.token);
        form.reset();
        showPanel();
    } catch (error) {
        $("login-message").textContent = error.message;
    } finally {
        // "finally" roda sempre, dando certo ou errado.
        button.disabled = false;
    }
}

/**
 * Tratamento padrão de erros do painel. Se o token venceu (401), volta
 * para a tela de login; senão, mostra a mensagem num alerta.
 */
function handleError(error) {
    if (error.status === 401) {
        showLogin("Sua sessão expirou. Entre novamente.");
    } else {
        window.alert(error.message);
    }
}


/* ==========================================================================
   LISTA DE ÁLBUNS
   ========================================================================== */
async function loadAlbums() {
    const status = $("albums-status");
    try {
        state.albums = await api("/albums");
        status.hidden = state.albums.length > 0;
        status.textContent = "Nenhum álbum ainda. Crie o primeiro acima.";
        $("album-list").replaceChildren(...state.albums.map(albumRow));
    } catch (error) {
        status.hidden = false;
        status.textContent = `Erro ao carregar: ${error.message}`;
        handleError(error);
    }
}

function albumRow(album) {
    const isActive = state.current && state.current.id === album.id;

    const publicToggle = el("input", {
        type: "checkbox",
        checked: album.is_public,
        onchange: (event) => togglePublic(album, event.target),
    });

    return el("li", { class: `album-row${isActive ? " album-row--active" : ""}` }, [
        el("div", { class: "album-row__title", text: album.title }),
        el("div", {
            class: "album-row__meta",
            text: pluralize(album.photo_count, "foto", "fotos"),
        }),
        el("div", { class: "album-row__actions" }, [
            el("label", {}, [publicToggle, "Público"]),
            el("button", {
                class: "btn btn--small",
                type: "button",
                text: "Gerenciar",
                onclick: () => openAlbum(album.slug),
            }),
            el("button", {
                class: "btn btn--small btn--danger",
                type: "button",
                text: "Excluir",
                onclick: () => deleteAlbum(album),
            }),
        ]),
    ]);
}

async function createAlbum(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const data = new FormData(form);

    button.disabled = true;
    $("album-message").textContent = "";
    try {
        const album = await api("/albums", {
            method: "POST",
            body: {
                title: data.get("title"),
                description: data.get("description") || null,
                // Checkbox marcado envia "on"; desmarcado não envia nada.
                is_public: data.get("is_public") === "on",
            },
        });
        form.reset();
        await openAlbum(album.slug);
        await loadAlbums();
    } catch (error) {
        $("album-message").textContent = error.message;
        if (error.status === 401) {
            handleError(error);
        }
    } finally {
        button.disabled = false;
    }
}

async function togglePublic(album, checkbox) {
    checkbox.disabled = true;
    try {
        await api(`/albums/${album.id}`, {
            method: "PATCH",
            body: { is_public: checkbox.checked },
        });
        album.is_public = checkbox.checked;
    } catch (error) {
        checkbox.checked = !checkbox.checked; // desfaz a mudança visual
        handleError(error);
    } finally {
        checkbox.disabled = false;
    }
}

async function deleteAlbum(album) {
    const question = `Excluir o álbum "${album.title}" e ${pluralize(album.photo_count, "foto", "fotos")}?\n`
        + "Os arquivos serão apagados permanentemente.";
    if (!window.confirm(question)) {
        return;
    }
    try {
        await api(`/albums/${album.id}`, { method: "DELETE" });
        if (state.current && state.current.id === album.id) {
            closeManager();
        }
        await loadAlbums();
    } catch (error) {
        handleError(error);
    }
}


/* ==========================================================================
   ÁLBUM SELECIONADO: FOTOS
   ========================================================================== */
async function openAlbum(slug) {
    try {
        state.current = await api(`/albums/${encodeURIComponent(slug)}`);
    } catch (error) {
        handleError(error);
        return;
    }

    $("manager-empty").hidden = true;
    $("manager-content").hidden = false;
    $("manager-title").textContent = state.current.title;
    $("manager-view").href = `album.html?slug=${encodeURIComponent(slug)}`;
    renderManageGrid();

    // Atualiza o destaque na lista de álbuns.
    $("album-list").replaceChildren(...state.albums.map(albumRow));
}

function closeManager() {
    state.current = null;
    $("manager-content").hidden = true;
    $("manager-empty").hidden = false;
    $("upload-queue").replaceChildren();
}

function renderManageGrid() {
    const album = state.current;
    $("manage-grid").replaceChildren(...album.photos.map((photo) => manageCard(photo, album)));
}

function manageCard(photo, album) {
    const isCover = album.cover_photo_id === photo.id;

    return el("div", { class: "manage-card" }, [
        el("div", { class: "manage-card__thumb" }, [
            el("img", { src: photo.thumb_url, alt: photo.title || "", loading: "lazy" }),
            isCover && el("span", { class: "badge", text: "Capa" }),
        ]),
        el("div", { class: "manage-card__title", text: photo.title || "Sem título" }),
        el("div", { class: "manage-card__actions" }, [
            el("button", {
                class: "btn btn--small",
                type: "button",
                text: "Capa",
                title: "Usar como capa do álbum",
                disabled: isCover,
                onclick: () => setCover(photo),
            }),
            el("button", {
                class: "btn btn--small",
                type: "button",
                text: "Título",
                onclick: () => editPhoto(photo),
            }),
            el("button", {
                class: "btn btn--small btn--danger",
                type: "button",
                text: "Excluir",
                onclick: () => deletePhoto(photo),
            }),
        ]),
    ]);
}

async function setCover(photo) {
    try {
        await api(`/albums/${state.current.id}`, {
            method: "PATCH",
            body: { cover_photo_id: photo.id },
        });
        state.current.cover_photo_id = photo.id;
        renderManageGrid();
    } catch (error) {
        handleError(error);
    }
}

async function editPhoto(photo) {
    // prompt() abre uma caixinha nativa do navegador pedindo um texto.
    // Devolve null se a pessoa clicar em "Cancelar".
    const title = window.prompt("Título da foto:", photo.title || "");
    if (title === null) {
        return;
    }
    try {
        const updated = await api(`/photos/${photo.id}`, {
            method: "PATCH",
            body: { title: title.trim() || null },
        });
        photo.title = updated.title;
        renderManageGrid();
    } catch (error) {
        handleError(error);
    }
}

async function deletePhoto(photo) {
    if (!window.confirm("Excluir esta foto permanentemente?")) {
        return;
    }
    try {
        await api(`/photos/${photo.id}`, { method: "DELETE" });
        // Recarrega o álbum: a capa pode ter mudado.
        await openAlbum(state.current.slug);
        await loadAlbums();
    } catch (error) {
        handleError(error);
    }
}


/* ==========================================================================
   UPLOAD EM LOTE
   As fotos são enviadas UMA DE CADA VEZ. Enviar várias em paralelo
   disputaria a mesma conexão de internet e deixaria o navegador pesado
   (cada foto de 24 MP ocupa ~100 MB de memória ao gerar a miniatura).
   ========================================================================== */
function queueItem(file) {
    const status = el("span", { class: "upload-item__status", text: "Na fila" });
    const progress = el("progress", { max: "1", value: "0" });
    const item = el("li", { class: "upload-item" }, [
        el("span", { class: "upload-item__name", text: file.name, title: file.name }),
        status,
        progress,
    ]);
    return { item, status, progress };
}

async function handleFiles(fileList) {
    if (!state.current) {
        return;
    }
    const album = state.current; // fixa o álbum de destino deste lote
    const files = Array.from(fileList);
    if (files.length === 0) {
        return;
    }

    // Cria todas as linhas da fila primeiro, para a pessoa ver o lote todo.
    const entries = files.map((file) => ({ file, ...queueItem(file) }));
    $("upload-queue").append(...entries.map((entry) => entry.item));

    state.uploading += 1;
    for (const entry of entries) {
        try {
            const photo = await uploadPhoto(entry.file, album.id, (text, fraction) => {
                entry.status.textContent = text;
                entry.progress.value = fraction;
            });
            entry.item.classList.add("upload-item--done");

            // Mostra a foto nova na grade (se o álbum ainda estiver aberto).
            if (state.current && state.current.id === album.id) {
                state.current.photos.push(photo);
                if (!state.current.cover_photo_id) {
                    state.current.cover_photo_id = photo.id; // backend faz o mesmo
                }
                renderManageGrid();
            }
        } catch (error) {
            entry.item.classList.add("upload-item--error");
            entry.status.textContent = `Erro: ${error.message}`;
            if (error.status === 401) {
                state.uploading -= 1;
                handleError(error);
                return; // sem login não adianta tentar as próximas
            }
        }
    }
    state.uploading -= 1;

    // Atualiza a contagem de fotos na lista de álbuns.
    loadAlbums();
}

function setupDropzone() {
    const dropzone = $("dropzone");
    const input = $("file-input");

    input.addEventListener("change", () => {
        handleFiles(input.files);
        input.value = ""; // permite escolher os mesmos arquivos de novo
    });

    // "dragover" precisa de preventDefault para o navegador permitir o drop.
    dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("dropzone--over");
    });
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dropzone--over");
    });
    dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("dropzone--over");
        handleFiles(event.dataTransfer.files);
    });

    // Avisa antes de fechar a aba no meio de um envio.
    window.addEventListener("beforeunload", (event) => {
        if (state.uploading > 0) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
}


/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */
async function init() {
    $("login-form").addEventListener("submit", handleLogin);
    $("album-form").addEventListener("submit", createAlbum);
    setupDropzone();

    if (!Auth.isLoggedIn()) {
        showLogin();
        return;
    }

    // Confirma com o servidor que o token ainda vale (a senha ou a
    // SECRET_KEY podem ter sido trocadas desde o último login).
    try {
        const me = await api("/auth/me");
        if (me.authenticated) {
            showPanel();
        } else {
            Auth.clear();
            showLogin("Sua sessão expirou. Entre novamente.");
        }
    } catch (error) {
        showLogin(`Erro ao verificar sessão: ${error.message}`);
    }
}

document.addEventListener("DOMContentLoaded", init);
