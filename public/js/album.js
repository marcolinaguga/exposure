/*
 * album.js — página do álbum.
 *
 * 1. Lê o "slug" da URL (album.html?slug=ferias-2024).
 * 2. Busca o álbum e suas fotos na API.
 * 3. Monta a grade justificada de miniaturas.
 *
 * A miniatura (photoTile) e o visualizador em tela cheia (Viewer) vêm do
 * gallery.js, compartilhado com a página inicial.
 *
 * Depende de common.js e gallery.js.
 */

"use strict";

const $ = (id) => document.getElementById(id);

let albumPhotos = [];

async function loadAlbum() {
    const status = $("status");
    const slug = new URLSearchParams(window.location.search).get("slug");

    if (!slug) {
        status.textContent = "Álbum não informado.";
        status.classList.add("status--error");
        return;
    }

    try {
        const album = await api(`/albums/${encodeURIComponent(slug)}`);
        albumPhotos = album.photos;

        document.title = `${album.title} · Acervo Fotográfico`;
        $("album-title").textContent = album.title;
        $("album-description").textContent = album.description || "";

        if (album.photos.length === 0) {
            status.textContent = "Este álbum ainda não tem fotos.";
            return;
        }

        status.hidden = true;
        $("photos").replaceChildren(...album.photos.map(photoTile));

        // Se a página foi aberta já com "#foto-..." na URL, abre a foto.
        Viewer.sync();
    } catch (error) {
        status.textContent = error.status === 404
            ? "Álbum não encontrado."
            : `Não foi possível carregar o álbum: ${error.message}`;
        status.classList.add("status--error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    Viewer.init({
        getPhotos: () => albumPhotos,
        showCounter: true, // aqui sabemos o total: "3 de 20"
    });
    loadAlbum();
});
