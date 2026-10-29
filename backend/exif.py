"""
Tratamento dos dados EXIF no servidor.

A EXTRAÇÃO acontece no navegador (biblioteca JavaScript "exifr"), porque o
arquivo vai direto do navegador para o Supabase e nunca passa pela Vercel
(veja storage.py). O servidor recebe apenas os valores já extraídos, em
JSON, e aqui nós os LIMPAMOS e FORMATAMOS antes de salvar no banco.
"""

from backend.schemas import ExifData


def format_shutter_speed(exposure_time: float | None) -> str | None:
    """
    Converte o tempo de exposição (segundos) para a notação dos fotógrafos.

    Exemplos:
        0.004  -> "1/250"
        0.5    -> "1/2"
        1.0    -> '1"'
        2.5    -> '2.5"'
    """
    if exposure_time is None or exposure_time <= 0:
        return None
    if exposure_time >= 1:
        # :g remove zeros desnecessários (2.0 -> "2", 2.5 -> "2.5").
        return f'{exposure_time:g}"'
    return f"1/{round(1 / exposure_time)}"


def _clean_text(value: str | None) -> str | None:
    """Remove espaços extras e caracteres nulos; string vazia vira None."""
    if value is None:
        return None
    cleaned = " ".join(value.replace("\x00", "").split())
    return cleaned or None


def normalize_exif(exif: ExifData) -> dict:
    """
    Transforma o objeto ExifData em um dicionário pronto para o banco.

    Também evita repetição como "Canon Canon EOS Rebel T6i": muitas câmeras
    gravam o fabricante tanto em "Make" quanto no começo de "Model".
    """
    make = _clean_text(exif.camera_make)
    model = _clean_text(exif.camera_model)

    if make and model and model.lower().startswith(make.lower()):
        model = model[len(make):].strip() or model

    return {
        "camera_make": make,
        "camera_model": model,
        "lens_model": _clean_text(exif.lens_model),
        "focal_length": (
            round(exif.focal_length, 2) if exif.focal_length else None
        ),
        "aperture": round(exif.aperture, 2) if exif.aperture else None,
        "exposure_time": exif.exposure_time,
        "shutter_speed": format_shutter_speed(exif.exposure_time),
        "iso": exif.iso,
        # isoformat() converte a data para texto no padrão que o banco aceita.
        "taken_at": exif.taken_at.isoformat() if exif.taken_at else None,
    }
