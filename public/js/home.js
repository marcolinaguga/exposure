/*
 * home.js — página inicial.
 *
 * Três partes, de cima para baixo, como um livro:
 *   1. Destaque: a foto mais recente, grande, com legenda de prancha.
 *   2. Álbuns: os cartões dos álbuns públicos.
 *   3. Todas as fotos: grade justificada, carregada em páginas de 48
 *      conforme a pessoa rola (rolagem infinita).
 *
 * Depende de common.js (api, el, pluralize) e gallery.js (photoTile, Viewer).
 */

"use strict";

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 48;

// Estado da grade de fotos.
const feed = {
    photos: [], // todas as fotos já carregadas, na ordem da grade
    hasMore: true, // a API ainda tem fotos para enviar?
    loading: false, // há uma requisição em andamento?
};


/* ==========================================================================
   1. DESTAQUE
   ========================================================================== */

/** "2026-10-26T19:01:13+00:00" -> "26 de outubro de 2026" */
function formatDay(isoText) {
    if (!isoText) {
        return null;
    }
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Mostra a foto mais recente no destaque. Usamos a miniatura (1200 px):
 * o original pode ter mais de 10 MB, pesado demais para a primeira tela.
 */
function renderHero(photo) {
    const img = $("hero-img");
    img.alt = photo.title || "";
    // O fade só começa quando a imagem termina de baixar. O onload é
    // definido ANTES do src para não perder o evento de imagens em cache.
    img.onload = () => img.classList.add("is-loaded");
    img.src = photo.thumb_url;

    const link = $("hero-link");
    link.href = `#foto-${photo.id}`;
    link.setAttribute("aria-label", photo.title ? `Abrir ${photo.title}` : "Abrir a foto");
    link.addEventListener("click", () => Viewer.markOpenedFromGrid());

    // Legenda de prancha: título em itálico; álbum e data em cinza.
    const origin = [photo.album && photo.album.title, formatDay(photo.exif.taken_at)]
        .filter(Boolean)
        .join(", ");
    $("hero-caption").replaceChildren(
        ...[
            photo.title && el("em", { text: photo.title }),
            origin && el("span", { text: origin }),
        ].filter(Boolean),
    );

    $("hero-plate").hidden = false;
    $("hero").classList.remove("hero--text-only");
}


/* ==========================================================================
   2. ÁLBUNS
   ========================================================================== */

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
    const status = $("albums-status");
    try {
        const albums = await api("/albums");
        if (albums.length === 0) {
            status.textContent = "Nenhum álbum publicado ainda.";
            return;
        }
        status.hidden = true;
        $("albums").replaceChildren(...albums.map(albumCard));
    } catch (error) {
        status.textContent = `Não foi possível carregar os álbuns: ${error.message}`;
        status.classList.add("status--error");
    }
}


/* ==========================================================================
   3. TODAS AS FOTOS
   ========================================================================== */
function setFeedStatus(text, { error = false, retry = false } = {}) {
    const status = $("feed-status");
    status.classList.toggle("status--error", error);
    // replaceChildren escreveria um "false" literal na tela, então só
    // incluímos o botão quando ele existe.
    const children = text ? [text] : []; // vazio: o CSS recolhe a área
    if (retry) {
        children.push(el("button", {
            class: "btn btn--small",
            type: "button",
            text: "Tentar novamente",
            onclick: loadMorePhotos,
        }));
    }
    status.replaceChildren(...children);
}

async function loadMorePhotos() {
    // Evita pedir a mesma página duas vezes ao mesmo tempo.
    if (feed.loading || !feed.hasMore) {
        return;
    }
    feed.loading = true;
    setFeedStatus("Carregando…");

    try {
        const offset = feed.photos.length;
        const page = await api(`/photos?limit=${PAGE_SIZE}&offset=${offset}`);

        feed.photos.push(...page.photos);
        feed.hasMore = page.has_more;

        // A primeira foto da primeira página é a mais recente: vai para
        // o destaque (e continua também na grade, com as demais).
        if (offset === 0 && page.photos.length > 0) {
            renderHero(page.photos[0]);
        }

        // append() acrescenta ao fim, sem recriar as fotos que já estão lá.
        $("photos").append(...page.photos.map((photo, i) => photoTile(photo, offset + i)));

        setFeedStatus(feed.photos.length === 0 ? "Nenhuma foto publicada ainda." : "");
        Viewer.refresh(); // setas do visualizador, se ele estiver aberto
    } catch (error) {
        setFeedStatus(`Não foi possível carregar as fotos: ${error.message}`, {
            error: true,
            retry: true,
        });
        feed.loading = false;
        return;
    }
    feed.loading = false;

    // Telas grandes: se a página não encheu a tela, o marcador continua
    // visível e o observador não dispara de novo. Então conferimos aqui.
    if (feed.hasMore && sentinelIsNear()) {
        loadMorePhotos();
    }
}

function sentinelIsNear() {
    const rect = $("feed-sentinel").getBoundingClientRect();
    return rect.top < window.innerHeight + 800;
}

/**
 * Rolagem infinita com IntersectionObserver: o navegador avisa quando o
 * marcador (que fica depois da grade) chega a 800px de aparecer na tela.
 * É muito mais eficiente do que verificar a posição a cada rolagem.
 */
function setupInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMorePhotos();
        }
    }, { rootMargin: "800px 0px" });
    observer.observe($("feed-sentinel"));
}


/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */
document.addEventListener("DOMContentLoaded", async () => {
    Viewer.init({
        getPhotos: () => feed.photos,
        hasMore: () => feed.hasMore,
        // Navegando no visualizador perto do fim, já busca a próxima página.
        onNearEnd: loadMorePhotos,
    });

    // Álbuns e fotos são buscados ao mesmo tempo.
    loadAlbums();
    await loadMorePhotos();
    setupInfiniteScroll();

    // Página aberta por um link "#foto-...": abre a foto.
    Viewer.sync();
});
