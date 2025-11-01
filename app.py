import os
import uuid
import importlib

from flask import Flask, render_template, request, jsonify, url_for
from PIL import Image, ImageOps, ImageDraw, ImageFilter

# Optional readers for RAW (DNG) and EXR (via OpenCV)
try:
    import rawpy  # for .dng
except Exception:
    rawpy = None

# Try to import black-box engine module
_engine = None
try:
    _engine = importlib.import_module("engine")
except Exception:
    _engine = None

ALLOWED_EXTENSIONS = {"dng", "exr", "png", "jpg", "jpeg"}

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = os.path.join(app.root_path, "uploads")
app.config["GEN_FOLDER"] = os.path.join(app.root_path, "static", "gen")
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
os.makedirs(app.config["GEN_FOLDER"], exist_ok=True)


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _read_image_any(upath: str) -> Image.Image:
    """
    Read PNG/JPEG via Pillow, DNG via rawpy, EXR via OpenCV (cv2).
    Return a Pillow RGBA image suitable for previews and rendering.
    """
    ext = upath.rsplit(".", 1)[1].lower()

    # --- PNG/JPEG via Pillow ---
    if ext in ("png", "jpg", "jpeg"):
        im = Image.open(upath)
        return ImageOps.exif_transpose(im.convert("RGBA"))

    # --- DNG via rawpy ---
    if ext == "dng":
        if rawpy is None:
            raise RuntimeError("rawpy not installed; install with: pip install rawpy")
        with rawpy.imread(upath) as raw:
            rgb = raw.postprocess(
                use_camera_wb=True,
                no_auto_bright=True,
                output_bps=8,
                gamma=(2.222, 4.5),
            )
        return Image.fromarray(rgb, mode="RGB").convert("RGBA")

    # --- EXR via OpenCV (Windows-friendly) ---
    if ext == "exr":
        try:
            import cv2
            import numpy as np
        except Exception:
            raise RuntimeError(
                "opencv-python not installed; cannot read EXR. Install with: pip install opencv-python"
            )

        arr = cv2.imread(upath, cv2.IMREAD_UNCHANGED)
        if arr is None:
            raise RuntimeError("OpenCV failed to read EXR (cv2.imread returned None).")

        # Ensure 3 or 4 channels
        if arr.ndim == 2:
            arr = np.stack([arr, arr, arr], axis=-1)

        # Convert BGR[A] -> RGB[A]
        if arr.shape[2] == 4:
            arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2RGBA)
        else:
            arr = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)

        # Tone-map to 8-bit preview
        arr = arr.astype("float32")
        arr = np.nan_to_num(arr, nan=0.0, posinf=1.0, neginf=0.0)
        hi = float(np.percentile(arr, 99.5))
        if hi <= 0:
            hi = 1.0
        arr = (arr / hi).clip(0.0, 1.0) ** (1.0 / 2.2)
        arr8 = (arr * 255.0).astype("uint8")

        if arr8.shape[2] == 4:
            im = Image.fromarray(arr8, mode="RGBA")
        else:
            im = Image.fromarray(arr8, mode="RGB").convert("RGBA")
        return ImageOps.exif_transpose(im)

    # --- Fallback: try Pillow anyway ---
    im = Image.open(upath)
    return ImageOps.exif_transpose(im.convert("RGBA"))


def _orientation_render_wrapper(im: Image.Image, azimuth: float, zenith: float, roll: float) -> Image.Image:
    """
    Calls your partner’s black-box orientation implementation if available.
    Falls back to NO-OP (returns input) if NotImplemented or on error.
    """
    if _engine and hasattr(_engine, "orientation_render_impl"):
        try:
            return _engine.orientation_render_impl(im, azimuth, zenith, roll)
        except NotImplementedError:
            pass
        except Exception as e:
            print(f"[orientation_render_impl error] {e}")
    # ---- Fallback (NO-OP): return input unchanged ----
    return im


def _sky_segment_wrapper(im: Image.Image, points):
    """
    Calls your partner’s black-box sky segmentation implementation if available.
    Falls back to an empty transparent image if NotImplemented or on error.
    """
    if _engine and hasattr(_engine, "sky_segment_impl"):
        try:
            return _engine.sky_segment_impl(im, points)
        except NotImplementedError:
            pass
        except Exception as e:
            print(f"[sky_segment_impl error] {e}")
    # ---- Fallback (NO-OP): transparent same-size image ----
    return Image.new("RGBA", im.size, (0, 0, 0, 0))

def _forecast_energy_wrapper(im: Image.Image, azimuth: float, zenith: float, roll: float):
    """
    Calls your partner’s black-box solar forecast implementation if available.
    If not implemented, raises NotImplementedError so we can return 501.
    """
    if _engine and hasattr(_engine, "forecast_energy_impl"):
        return _engine.forecast_energy_impl(im, azimuth, zenith, roll)
    raise NotImplementedError("forecast_energy_impl not found in engine module.")



@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file part"}), 400
    f = request.files["file"]
    if f.filename == "":
        return jsonify({"ok": False, "error": "No selected file"}), 400
    if not allowed_file(f.filename):
        return jsonify({"ok": False, "error": "Unsupported file type"}), 400

    ext = f.filename.rsplit(".", 1)[1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    upath = os.path.join(app.config["UPLOAD_FOLDER"], fname)
    f.save(upath)

    try:
        im = _read_image_any(upath)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to read image: {e}"}), 400

    im.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    out_name = f"{uuid.uuid4().hex}.png"
    out_path = os.path.join(app.config["GEN_FOLDER"], out_name)
    im.save(out_path, "PNG")

    return jsonify({
        "ok": True,
        "upload_url": url_for("static", filename=f"gen/{out_name}", _external=False),
        "upload_id": out_name
    })


@app.route("/render", methods=["POST"])
def render_hemisphere():
    data = request.get_json(force=True)
    upload_id = data.get("upload_id")
    az = float(data.get("azimuth", 0))
    ze = float(data.get("zenith", 0))
    ro = float(data.get("roll", 0))

    if not upload_id:
        return jsonify({"ok": False, "error": "Missing upload id"}), 400

    src_path = os.path.join(app.config["GEN_FOLDER"], upload_id)
    if not os.path.exists(src_path):
        return jsonify({"ok": False, "error": "Uploaded preview not found"}), 404

    im = Image.open(src_path).convert("RGBA")
    out = _orientation_render_wrapper(im, az, ze, ro)

    out_name = f"view_{uuid.uuid4().hex}.png"
    out_path = os.path.join(app.config["GEN_FOLDER"], out_name)
    out.save(out_path, "PNG")

    return jsonify({
        "ok": True,
        "view_url": url_for("static", filename=f"gen/{out_name}", _external=False),
        "view_id": out_name
    })


@app.route("/segment", methods=["POST"])
def segment():
    data = request.get_json(force=True)
    upload_id = data.get("upload_id")
    points = data.get("points", [])
    if not upload_id or len(points) != 3:
        return jsonify({"ok": False, "error": "Need upload_id and exactly 3 points"}), 400

    src_path = os.path.join(app.config["GEN_FOLDER"], upload_id)
    if not os.path.exists(src_path):
        return jsonify({"ok": False, "error": "Uploaded preview not found"}), 404

    im = Image.open(src_path).convert("RGBA")
    result = _sky_segment_wrapper(im, points)

    out_name = f"sky_{uuid.uuid4().hex}.png"
    out_path = os.path.join(app.config["GEN_FOLDER"], out_name)
    result.save(out_path, "PNG")

    return jsonify({
        "ok": True,
        "sky_url": url_for("static", filename=f"gen/{out_name}", _external=False),
        "sky_id": out_name
    })

def _forecast_energy_wrapper(im: Image.Image, azimuth: float, zenith: float, roll: float, points):
    """
    Calls your partner’s black-box solar forecast implementation if available.
    """
    if _engine and hasattr(_engine, "forecast_energy_impl"):
        # New signature includes points (3 clicks) for sky aperture context
        return _engine.forecast_energy_impl(im, azimuth, zenith, roll, points)
    raise NotImplementedError("forecast_energy_impl not found in engine module.")

@app.route("/forecast", methods=["POST"])
def forecast():
    data = request.get_json(force=True)
    upload_id = data.get("upload_id")
    az = float(data.get("azimuth", 0))
    ze = float(data.get("zenith", 0))
    ro = float(data.get("roll", 0))
    points = data.get("points", [])

    if not upload_id:
        return jsonify({"ok": False, "error": "Missing upload id"}), 400

    src_path = os.path.join(app.config["GEN_FOLDER"], upload_id)
    if not os.path.exists(src_path):
        return jsonify({"ok": False, "error": "Uploaded preview not found"}), 404

    im = Image.open(src_path).convert("RGBA")
    try:
        result = _forecast_energy_wrapper(im, az, ze, ro, points)
        return jsonify({"ok": True, "result": result})
    except NotImplementedError as e:
        return jsonify({"ok": False, "error": str(e)}), 501
    except Exception as e:
        return jsonify({"ok": False, "error": f"Forecast failed: {e}"}), 500


if __name__ == "__main__":
    # Run dev server
    app.run(host="0.0.0.0", port=8000, debug=True)
