/*
 * gallery.js — peças de galeria usadas pela página inicial E pela página
 * do álbum:
 *
 *   photoTile(photo, index) -> cria uma miniatura da grade justificada;
 *   Viewer                  -> o visualizador em tela cheia com EXIF.
 *
 * Antes este código ficava só no album.js. Como a página inicial também
 * mostra fotos, ele foi movido para cá para não ser duplicado.
 *
 * O visualizador funciona pelo endereço: abrir uma foto muda a URL para
 * "#foto-<id>". Assim o link pode ser compartilhado já com a foto aberta,
 * e o botão "voltar" do navegador fecha o visualizador.
 *
 * Depende de common.js (el, api, exifRows, exifSummary, formatBytes).
 */

"use strict";


/* ==========================================================================
   MINIATURA DA GRADE
   ========================================================================== */

/**
 * Cria o link-miniatura de uma foto. Ao passar o mouse, aparece uma
 * legenda com o título (ou o nome do álbum) e o resumo do EXIF.
 */
function photoTile(photo, index) {
    // Sem dimensões conhecidas, assume o formato 3:2 de uma DSLR.
    const width = photo.width || 3;
    const height = photo.height || 2;

    const caption = photo.title || (photo.album && photo.album.title) || "";
    const summary = exifSummary(photo.exif);

    return el("a", {
        class: "photo-tile",
        href: `#foto-${photo.id}`,
        // --w e --h alimentam o cálculo da grade no CSS (seção 6).
        style: { "--w": width, "--h": height },
        "aria-label": caption || `Foto ${index + 1}`,
        // O link muda a URL; aqui só anotamos que a abertura veio da grade.
        onclick: () => Viewer.markOpenedFromGrid(),
    }, [
        el("img", {
            src: photo.thumb_url,
            alt: photo.title || "",
            loading: "lazy", // só baixa quando estiver perto de aparecer
            decoding: "async",
        }),
        (caption || summary) && el("span", { class: "photo-tile__caption" }, [
            caption && el("strong", { text: caption }),
            summary && el("span", { text: summary }),
        ]),
    ]);
}


/* ==========================================================================
   VISUALIZADOR
   O padrão "const Viewer = (() => { ... return {...}; })();" cria um
   objeto com variáveis PRIVADAS: só as funções devolvidas no final
   (init, sync, refresh, markOpenedFromGrid) podem ser usadas de fora.
   ========================================================================== */
const Viewer = (() => {
    const refs = {}; // elementos HTML do visualizador
    let options = {
        getPhotos: () => [], // função que devolve a lista de fotos da página
        hasMore: () => false, // existem mais fotos ainda não carregadas?
        onNearEnd: null, // chamada perto do fim da lista (carregar mais)
        showCounter: false, // mostrar "3 de 20"?
    };
    let standalone = null; // foto aberta por link que não está na lista
    let current = -1; // índice da foto aberta (-1 = fechado)
    let openedFromGrid = false;

    const list = () => standalone || options.getPhotos();

    /** Monta o HTML do visualizador e liga os eventos (uma única vez). */
    function build() {
        refs.img = el("img", { alt: "" });
        refs.prev = el("button", {
            class: "viewer__nav viewer__nav--prev",
            type: "button",
            "aria-label": "Foto anterior",
            text: "‹", // ‹
            onclick: () => goTo(current - 1),
        });
        refs.next = el("button", {
            class: "viewer__nav viewer__nav--next",
            type: "button",
            "aria-label": "Próxima foto",
            text: "›", // ›
            onclick: () => goTo(current + 1),
        });
        refs.close = el("button", {
            class: "viewer__close",
            type: "button",
            "aria-label": "Fechar",
            text: "×", // ×
            onclick: requestClose,
        });
        refs.stage = el("div", { class: "viewer__stage" }, [
            refs.img, refs.prev, refs.next, refs.close,
        ]);

        refs.title = el("h2");
        refs.album = el("a", { class: "viewer__album" });
        refs.description = el("p", { class: "viewer__description" });
        refs.counter = el("p", { class: "viewer__counter" });
        refs.exif = el("dl", { class: "exif" });
        refs.original = el("a", {
            class: "btn",
            target: "_blank",
            rel: "noopener",
            text: "Abrir original",
        });

        // role="dialog" e aria-* ajudam leitores de tela a entender que
        // é uma janela sobreposta.
        refs.root = el("div", {
            class: "viewer",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Visualização da foto",
            hidden: true,
        }, [
            refs.stage,
            el("aside", { class: "viewer__info" }, [
                refs.title, refs.album, refs.description,
                refs.counter, refs.exif, refs.original,
            ]),
        ]);
        document.body.append(refs.root);

        // Clicar no fundo escuro (fora da foto) fecha.
        refs.stage.addEventListener("click", (event) => {
            if (event.target === refs.stage) {
                requestClose();
            }
        });

        // Teclado: setas navegam, Esc fecha.
        document.addEventListener("keydown", (event) => {
            if (current < 0) {
                return;
            }
            if (event.key === "ArrowLeft") {
                goTo(current - 1);
            } else if (event.key === "ArrowRight") {
                goTo(current + 1);
            } else if (event.key === "Escape") {
                requestClose();
            }
        });

        // Celular: deslizar o dedo para os lados troca de foto.
        let touchStartX = null;
        refs.stage.addEventListener("touchstart", (event) => {
            touchStartX = event.touches[0].clientX;
        }, { passive: true });
        refs.stage.addEventListener("touchend", (event) => {
            if (touchStartX === null) {
                return;
            }
            const deltaX = event.changedTouches[0].clientX - touchStartX;
            touchStartX = null;
            if (Math.abs(deltaX) > 50) {
                goTo(current + (deltaX < 0 ? 1 : -1));
            }
        });

        window.addEventListener("hashchange", sync);
    }

    /** Liga o visualizador na página. Chamar uma vez, no carregamento. */
    function init(userOptions = {}) {
        options = { ...options, ...userOptions };
        build();
    }

    /**
     * Lê o "#foto-<id>" da URL e abre/fecha o visualizador de acordo.
     * Se a foto não estiver na lista carregada (link compartilhado de uma
     * foto antiga, por exemplo), busca só ela na API.
     */
    async function sync() {
        const match = window.location.hash.match(/^#foto-(.+)$/);
        if (!match) {
            close();
            return;
        }
        const id = decodeURIComponent(match[1]);

        const index = options.getPhotos().findIndex((photo) => photo.id === id);
        if (index >= 0) {
            standalone = null;
            show(index);
            return;
        }

        try {
            standalone = [await api(`/photos/${encodeURIComponent(id)}`)];
            show(0);
        } catch {
            clearHash(); // foto inexistente ou privada: ignora o link
        }
    }

    function show(index) {
        const photos = list();
        const photo = photos[index];
        current = index;

        // Carregamento progressivo: mostra a miniatura (já em cache) na
        // hora e troca pela versão grande quando ela terminar de baixar.
        refs.img.alt = photo.title || "";
        refs.img.src = photo.thumb_url;
        const full = new Image();
        full.onload = () => {
            if (list()[current] === photo) {
                refs.img.src = photo.url;
            }
        };
        full.src = photo.url;

        refs.title.textContent = photo.title || "Sem título";
        refs.description.textContent = photo.description || "";
        refs.original.href = photo.url;

        // Link para o álbum (a vitrine da página inicial mistura álbuns).
        const album = photo.album;
        refs.album.hidden = !(album && album.slug);
        if (!refs.album.hidden) {
            refs.album.href = `album.html?slug=${encodeURIComponent(album.slug)}`;
            refs.album.textContent = `Álbum: ${album.title}`;
        }

        renderExif(photo);
        refresh();

        if (refs.root.hidden) {
            refs.root.hidden = false;
            document.body.style.overflow = "hidden"; // trava a rolagem do fundo
            refs.close.focus();
        }

        // Pré-carrega a próxima foto grande para a navegação ficar instantânea.
        const next = photos[index + 1];
        if (next) {
            new Image().src = next.url;
        }

        // Perto do fim da lista? Pede para a página carregar mais fotos.
        if (!standalone && options.onNearEnd && index >= photos.length - 3) {
            options.onNearEnd();
        }
    }

    /** Atualiza setas e contador (ex.: depois que mais fotos chegaram). */
    function refresh() {
        if (current < 0) {
            return;
        }
        const total = list().length;
        const atEnd = current >= total - 1;
        refs.prev.hidden = current === 0;
        refs.next.hidden = atEnd && (Boolean(standalone) || !options.hasMore());
        refs.counter.hidden = !options.showCounter || Boolean(standalone);
        refs.counter.textContent = `${current + 1} de ${total}`;
    }

    function renderExif(photo) {
        const rows = exifRows(photo.exif);

        // Dimensões e tamanho do arquivo também entram na ficha técnica.
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
        refs.exif.replaceChildren(...items);
    }

    function close() {
        current = -1;
        standalone = null;
        openedFromGrid = false;
        refs.root.hidden = true;
        refs.img.removeAttribute("src");
        document.body.style.overflow = "";
    }

    /**
     * Navegação: muda o "#" da URL e deixa o evento "hashchange" chamar
     * sync(). replace() troca a foto sem criar várias entradas no
     * histórico: o "voltar" fecha o visualizador de uma vez.
     */
    function goTo(index) {
        const photos = list();
        if (index >= 0 && index < photos.length) {
            window.location.replace(`#foto-${photos[index].id}`);
        }
    }

    function clearHash() {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        close();
    }

    function requestClose() {
        // Aberta pela grade: o clique criou uma entrada no histórico, e
        // voltar uma entrada fecha (via hashchange). Aberta por link
        // direto: voltar sairia do site, então só limpamos o "#".
        if (openedFromGrid) {
            window.history.back();
        } else {
            clearHash();
        }
    }

    return {
        init,
        sync,
        refresh,
        markOpenedFromGrid: () => {
            openedFromGrid = true;
        },
    };
})();
