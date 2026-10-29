/*
 * home.js — página inicial (vitrine).
 *
 * Aba "Fotos": busca as fotos públicas em páginas de 48 e as acrescenta à
 * grade conforme a pessoa rola (rolagem infinita).
 * Aba "Álbuns": cartões dos álbuns públicos, carregados na primeira visita
 * à aba.
 *
 * Depende de common.js (api, el, pluralize) e gallery.js (photoTile, Viewer).
 */

"use strict";

const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 48;

// Estado da vitrine de fotos.
const feed = {
    photos: [], // todas as fotos já carregadas, na ordem da grade
    hasMore: true, // a API ainda tem fotos para enviar?
    loading: false, // há uma requisição em andamento?
};

let albumsLoaded = false;


/* ==========================================================================
   ABA FOTOS
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

        // append() acrescenta ao fim, sem recriar as fotos que já estão lá.
        $("photos").append(...page.photos.map((photo, i) => photoTile(photo, offset + i)));

        if (feed.photos.length === 0) {
            setFeedStatus("Nenhuma foto publicada ainda.");
        } else {
            setFeedStatus("");
        }
        Viewer.refresh(); // setas do visualizador, se ele estiver aberto
    } catch (error) {
        setFeedStatus(`Não foi possível carregar as fotos: ${error.message} `, {
            error: true,
            retry: true,
        });
        feed.loading = false;
        return;
    }
    feed.loading = false;

    // Telas grandes: se a 1ª página não encheu a tela, o marcador continua
    // visível e o observador não dispara de novo. Então conferimos aqui.
    if (feed.hasMore && sentinelIsNear()) {
        loadMorePhotos();
    }
}

function sentinelIsNear() {
    // Aba de fotos escondida: o marcador não está na tela (sem isso, um
    // elemento escondido "mede" 0 e pareceria sempre visível).
    if ($("section-fotos").hidden) {
        return false;
    }
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
   ABA ÁLBUNS
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
    albumsLoaded = true;
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
        albumsLoaded = false; // permite tentar de novo ao reabrir a aba
        status.textContent = `Não foi possível carregar os álbuns: ${error.message}`;
        status.classList.add("status--error");
    }
}


/* ==========================================================================
   ABAS
   O "#" da URL guarda a aba aberta (#fotos ou #albuns), então o link
   index.html#albuns abre direto nos álbuns. "#foto-..." é do visualizador
   e não muda a aba.
   ========================================================================== */
function showTab(name) {
    $("section-fotos").hidden = name !== "fotos";
    $("section-albuns").hidden = name !== "albuns";

    // aria-current marca a aba ativa (o CSS usa isso para o sublinhado).
    for (const tab of ["fotos", "albuns"]) {
        const link = $(`tab-${tab}`);
        if (tab === name) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    }

    if (name === "albuns" && !albumsLoaded) {
        loadAlbums();
    }
}

function syncTabWithHash() {
    const hash = window.location.hash;
    if (hash.startsWith("#foto-")) {
        return; // o visualizador cuida desse caso
    }
    showTab(hash === "#albuns" ? "albuns" : "fotos");
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

    window.addEventListener("hashchange", syncTabWithHash);
    syncTabWithHash();

    await loadMorePhotos();
    setupInfiniteScroll();

    // Página aberta por um link "#foto-...": abre a foto.
    Viewer.sync();
});
