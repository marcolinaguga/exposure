/*
 * album.js — página do álbum.
 *
 * 1. Lê o "slug" da URL (album.html?slug=ferias-2024).
 * 2. Busca o álbum e suas fotos na API.
 * 3. Monta a grade justificada de miniaturas.
 * 4. Ao clicar numa foto, abre o visualizador com a imagem grande + EXIF.
 *
 * O endereço muda para "#foto-<id>" quando uma foto está aberta. Assim
 * você pode copiar o link e mandar para alguém já com aquela foto aberta,
 * e o botão "voltar" do navegador fecha o visualizador.
 *
 * Depende de common.js.
 */

"use strict";

// Estado da página: variáveis que guardam o que está acontecendo agora.
const state = {
    photos: [],
    current: -1, // índice da foto aberta (-1 = visualizador fechado)
    openedFromGrid: false, // a foto foi aberta clicando na grade?
};

// Atalho para pegar elementos pelo id.
const $ = (id) => document.getElementById(id);


/* ==========================================================================
   GRADE DE MINIATURAS
   ========================================================================== */
function photoTile(photo, index) {
    // Sem dimensões conhecidas, assume o formato 3:2 de uma DSLR.
    const width = photo.width || 3;
    const height = photo.height || 2;

    return el("a", {
        class: "photo-tile",
        href: `#foto-${photo.id}`,
        // --w e --h alimentam o cálculo da grade no CSS (seção 6).
        style: { "--w": width, "--h": height },
        "aria-label": photo.title || `Foto ${index + 1}`,
        // O link em si muda a URL para "#foto-..."; aqui só anotamos que
        // a abertura veio da grade (usado em requestClose).
        onclick: () => {
            state.openedFromGrid = true;
        },
    }, [
        el("img", {
            src: photo.thumb_url,
            alt: photo.title || "",
            loading: "lazy", // só baixa quando estiver perto de aparecer
            decoding: "async",
        }),
    ]);
}

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
        state.photos = album.photos;

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
        syncWithHash();
    } catch (error) {
        status.textContent = error.status === 404
            ? "Álbum não encontrado."
            : `Não foi possível carregar o álbum: ${error.message}`;
        status.classList.add("status--error");
    }
}


/* ==========================================================================
   VISUALIZADOR
   ========================================================================== */

/** Lê o "#foto-<id>" da URL e abre/fecha o visualizador de acordo. */
function syncWithHash() {
    const match = window.location.hash.match(/^#foto-(.+)$/);
    const index = match
        ? state.photos.findIndex((photo) => photo.id === match[1])
        : -1;

    if (index >= 0) {
        showPhoto(index);
    } else {
        closeViewer();
    }
}

function showPhoto(index) {
    const photo = state.photos[index];
    state.current = index;

    const img = $("viewer-img");
    img.alt = photo.title || "";

    // Truque de carregamento progressivo: mostra a miniatura (que já está
    // em cache) na hora e troca pela versão grande quando ela terminar de
    // baixar. Originais da T6i podem ter 10+ MB.
    img.src = photo.thumb_url;
    const full = new Image();
    full.onload = () => {
        // Só troca se o usuário ainda estiver na mesma foto.
        if (state.current === index) {
            img.src = photo.url;
        }
    };
    full.src = photo.url;

    $("viewer-title").textContent = photo.title || "Sem título";
    $("viewer-description").textContent = photo.description || "";
    $("viewer-counter").textContent = `${index + 1} de ${state.photos.length}`;
    $("viewer-original").href = photo.url;
    renderExif(photo);

    $("viewer-prev").hidden = index === 0;
    $("viewer-next").hidden = index === state.photos.length - 1;

    const viewer = $("viewer");
    if (viewer.hidden) {
        viewer.hidden = false;
        document.body.style.overflow = "hidden"; // trava a rolagem do fundo
        $("viewer-close").focus();
    }

    // Pré-carrega a próxima foto grande para a navegação ficar instantânea.
    const next = state.photos[index + 1];
    if (next) {
        new Image().src = next.url;
    }
}

function renderExif(photo) {
    const rows = exifRows(photo.exif);

    // Dimensões e tamanho do arquivo também são úteis na ficha técnica.
    if (photo.width && photo.height) {
        rows.push(["Dimensões", `${photo.width} × ${photo.height} px`]);
    }
    const size = formatBytes(photo.file_size);
    if (size) {
        rows.push(["Arquivo", size]);
    }

    const items = rows.flatMap(([label, value]) => [
        el("dt", { text: label }),
        el("dd", { text: String(value) }),
    ]);

    if (items.length === 0) {
        items.push(el("dd", { class: "exif__empty", text: "Sem dados EXIF." }));
    }
    $("viewer-exif").replaceChildren(...items);
}

function closeViewer() {
    state.current = -1;
    state.openedFromGrid = false;
    $("viewer").hidden = true;
    $("viewer-img").removeAttribute("src");
    document.body.style.overflow = "";
}

/**
 * Navegação: em vez de chamar showPhoto() direto, mudamos o "#" da URL.
 * O evento "hashchange" (lá embaixo) cuida do resto. Assim o histórico
 * do navegador fica sempre coerente.
 */
function goTo(index) {
    if (index >= 0 && index < state.photos.length) {
        // replace: trocar de foto não deve criar várias entradas no
        // histórico; o "voltar" deve fechar o visualizador de uma vez.
        window.location.replace(`#foto-${state.photos[index].id}`);
    }
}

function requestClose() {
    // Se a foto foi aberta clicando na grade, o clique criou uma entrada no
    // histórico; voltar uma entrada fecha o visualizador (via hashchange).
    // Se a página foi aberta direto por um link "#foto-...", voltar sairia
    // do site, então apenas limpamos o "#" e fechamos.
    if (state.openedFromGrid) {
        window.history.back();
    } else {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        closeViewer();
    }
}


/* ==========================================================================
   EVENTOS
   ========================================================================== */
function setupViewerEvents() {
    $("viewer-prev").addEventListener("click", () => goTo(state.current - 1));
    $("viewer-next").addEventListener("click", () => goTo(state.current + 1));
    $("viewer-close").addEventListener("click", requestClose);

    // Clicar no fundo escuro (fora da foto) também fecha.
    $("viewer-stage").addEventListener("click", (event) => {
        if (event.target.id === "viewer-stage") {
            requestClose();
        }
    });

    // Teclado: setas navegam, Esc fecha.
    document.addEventListener("keydown", (event) => {
        if (state.current < 0) {
            return;
        }
        if (event.key === "ArrowLeft") {
            goTo(state.current - 1);
        } else if (event.key === "ArrowRight") {
            goTo(state.current + 1);
        } else if (event.key === "Escape") {
            requestClose();
        }
    });

    // Celular: deslizar o dedo para os lados troca de foto.
    let touchStartX = null;
    $("viewer-stage").addEventListener("touchstart", (event) => {
        touchStartX = event.touches[0].clientX;
    }, { passive: true });
    $("viewer-stage").addEventListener("touchend", (event) => {
        if (touchStartX === null) {
            return;
        }
        const deltaX = event.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(deltaX) > 50) {
            goTo(state.current + (deltaX < 0 ? 1 : -1));
        }
    });

    window.addEventListener("hashchange", syncWithHash);
}

document.addEventListener("DOMContentLoaded", () => {
    setupViewerEvents();
    loadAlbum();
});
