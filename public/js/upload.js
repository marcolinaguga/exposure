/*
 * upload.js — envio de UMA foto, do computador até o banco.
 *
 * Por que tanto trabalho no navegador? (resumo da decisão de arquitetura)
 * A Vercel aceita no máximo ~4,5 MB por requisição, e uma foto da T6i
 * exportada do Lightroom passa disso. Então:
 *   - o EXIF é lido AQUI (biblioteca exifr);
 *   - a miniatura é gerada AQUI (elemento <canvas>);
 *   - o arquivo vai DIRETO para o Supabase Storage, usando uma URL
 *     temporária que o nosso backend autoriza.
 * O backend só recebe pedidos pequenos em JSON.
 *
 * Depende de common.js (api) e da biblioteca exifr (carregada no HTML).
 */

"use strict";

const UPLOAD_CONFIG = {
    maxFileSize: 50 * 1024 * 1024, // 50 MB: limite do bucket no Supabase
    allowedTypes: ["image/jpeg", "image/png"],
    thumbMaxSide: 1200, // maior lado da miniatura, em pixels
    thumbQuality: 0.85, // qualidade do JPEG da miniatura (0 a 1)
};


/* ==========================================================================
   1. LEITURA DO EXIF
   ========================================================================== */

/** Devolve o texto sem espaços sobrando, ou null se vazio. */
function cleanText(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Devolve um número positivo, ou null. */
function positiveNumber(value) {
    const number = Number(Array.isArray(value) ? value[0] : value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Lê os metadados da foto e devolve um objeto no formato que o backend
 * espera (veja ExifData em backend/schemas.py).
 *
 * Nomes das tags EXIF usadas:
 *   Make / Model      -> fabricante e modelo da câmera
 *   LensModel         -> lente (o Lightroom também grava em XMP como "Lens")
 *   FocalLength       -> distância focal (mm)
 *   FNumber           -> abertura (ƒ/)
 *   ExposureTime      -> tempo de exposição em segundos (0.004 = 1/250)
 *   ISO               -> sensibilidade
 *   DateTimeOriginal  -> quando a foto foi tirada
 */
async function extractExif(file) {
    try {
        const data = await exifr.parse(file, {
            tiff: true,
            exif: true,
            xmp: true, // dados que o Lightroom grava (ex.: nome da lente)
            gps: false, // não lemos localização, por privacidade
            ifd1: false,
            interop: false,
        });

        if (!data) {
            return {};
        }

        const taken = data.DateTimeOriginal || data.CreateDate;
        const takenValid = taken instanceof Date && !Number.isNaN(taken.getTime());

        return {
            camera_make: cleanText(data.Make),
            camera_model: cleanText(data.Model),
            lens_model: cleanText(data.LensModel) || cleanText(data.Lens),
            focal_length: positiveNumber(data.FocalLength),
            aperture: positiveNumber(data.FNumber),
            exposure_time: positiveNumber(data.ExposureTime),
            iso: positiveNumber(data.ISO) ? Math.round(positiveNumber(data.ISO)) : null,
            // toISOString(): formato de data padrão que o Python entende.
            taken_at: takenValid ? taken.toISOString() : null,
        };
    } catch (error) {
        // Foto sem EXIF ou arquivo estranho: segue sem metadados.
        console.warn("Não foi possível ler o EXIF:", error);
        return {};
    }
}


/* ==========================================================================
   2. MINIATURA
   ========================================================================== */

/**
 * Gera uma versão pequena (JPEG) da foto para a grade, que carrega muito
 * mais rápido que o original. Devolve também as dimensões ORIGINAIS.
 */
async function makeThumbnail(file) {
    // createImageBitmap decodifica a imagem e já respeita a orientação
    // gravada no EXIF (foto tirada com a câmera "em pé").
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, UPLOAD_CONFIG.thumbMaxSide / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    // Fundo branco: PNGs transparentes ficariam pretos no JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // toBlob usa "callback"; o "new Promise" o transforma em algo que
    // podemos usar com await.
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error("Falha ao gerar miniatura."))),
            "image/jpeg",
            UPLOAD_CONFIG.thumbQuality,
        );
    });

    const result = { blob, width: bitmap.width, height: bitmap.height };
    bitmap.close(); // libera a memória da imagem decodificada
    return result;
}


/* ==========================================================================
   3. ENVIO DO ARQUIVO PARA O SUPABASE
   ========================================================================== */

/**
 * Envia um arquivo para a URL assinada do Supabase (método PUT).
 *
 * Usamos XMLHttpRequest em vez de fetch() porque só ele informa o
 * PROGRESSO do envio, e arquivos de 15 MB merecem uma barra de progresso.
 */
function putFile(url, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", contentType);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress(event.loaded / event.total);
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Falha no envio ao Storage (${xhr.status}): ${xhr.responseText}`));
            }
        };
        xhr.onerror = () => reject(new Error("Erro de rede durante o envio."));

        xhr.send(blob);
    });
}


/* ==========================================================================
   4. FLUXO COMPLETO
   ========================================================================== */

/**
 * Envia uma foto para o álbum e devolve a foto criada (JSON da API).
 *
 * onProgress(texto, fração) é chamado a cada etapa, para a tela mostrar
 * o andamento. "fração" vai de 0 a 1.
 */
async function uploadPhoto(file, albumId, onProgress) {
    if (!UPLOAD_CONFIG.allowedTypes.includes(file.type)) {
        throw new Error("Formato não suportado (use JPG ou PNG).");
    }
    if (file.size > UPLOAD_CONFIG.maxFileSize) {
        throw new Error("Arquivo maior que 50 MB.");
    }

    // Etapa 1: EXIF e miniatura AO MESMO TEMPO (Promise.all espera os dois).
    onProgress("Lendo EXIF…", 0);
    const [exif, thumb] = await Promise.all([extractExif(file), makeThumbnail(file)]);

    // Etapa 2: pede ao backend as URLs de upload.
    onProgress("Preparando envio…", 0.03);
    const slot = await api("/photos/upload-url", {
        method: "POST",
        body: { album_id: albumId, content_type: file.type },
    });

    // Etapa 3: envia miniatura e original direto para o Supabase.
    // As frações (0.05→0.10 e 0.10→0.95) dividem a barra entre as etapas.
    await putFile(slot.thumbnail.signed_url, thumb.blob, "image/jpeg", (p) => {
        onProgress("Enviando miniatura…", 0.05 + p * 0.05);
    });
    await putFile(slot.original.signed_url, file, file.type, (p) => {
        onProgress(`Enviando original… ${Math.round(p * 100)}%`, 0.10 + p * 0.85);
    });

    // Etapa 4: registra a foto no banco com os metadados.
    onProgress("Registrando…", 0.97);
    const photo = await api("/photos", {
        method: "POST",
        body: {
            id: slot.photo_id,
            album_id: albumId,
            content_type: file.type,
            width: thumb.width,
            height: thumb.height,
            file_size: file.size,
            exif,
        },
    });

    onProgress("Concluído", 1);
    return photo;
}
