/*
 * home.js — página inicial: busca os álbuns na API e monta os cartões.
 * Depende de common.js (api, el, pluralize, Auth).
 */

"use strict";

/** Cria o cartão (link) de um álbum. */
function albumCard(album) {
    const cover = album.cover_url
        ? el("img", { src: album.cover_url, alt: "", loading: "lazy" })
        : el("div", { class: "album-card__placeholder", text: "Sem fotos" });

    return el("a", {
        class: "album-card",
        // encodeURIComponent protege caracteres especiais na URL.
        href: `album.html?slug=${encodeURIComponent(album.slug)}`,
    }, [
        el("div", { class: "album-card__cover" }, [
            cover,
            // Só o proprietário logado vê álbuns privados; marcamos com selo.
            !album.is_public && el("span", { class: "badge", text: "Privado" }),
        ]),
        el("div", { class: "album-card__info" }, [
            el("h2", { text: album.title }),
            el("p", { text: pluralize(album.photo_count, "foto", "fotos") }),
        ]),
    ]);
}

async function loadAlbums() {
    const status = document.getElementById("status");
    const container = document.getElementById("albums");

    try {
        const albums = await api("/albums");

        if (albums.length === 0) {
            status.textContent = "Nenhum álbum publicado ainda.";
            return;
        }

        status.hidden = true;
        // "..." (spread) passa cada item da lista como argumento separado.
        container.replaceChildren(...albums.map(albumCard));
    } catch (error) {
        status.textContent = `Não foi possível carregar os álbuns: ${error.message}`;
        status.classList.add("status--error");
    }
}

document.addEventListener("DOMContentLoaded", loadAlbums);
