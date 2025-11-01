"""
engine.py: Algorithm hooks for Single Shot Solar Forecast.

Replace the NotImplementedError bodies with our implementations.
The Flask app imports these at runtime and treats them as black boxes.
"""

from typing import List, Dict, Any, TypedDict
from PIL import Image


class Point(TypedDict):
    """Normalized canvas coordinate in [0,1]x[0,1]."""
    x: float  # 0 = left, 1 = right
    y: float  # 0 = top, 1 = bottom


def orientation_render_impl(
    source_image: Image.Image,
    azimuth: float,
    zenith: float,
    roll: float,
) -> Image.Image:
    """
    Return a hemispherical view of `source_image` for the given orientation.

    Inputs
    - source_image: PIL image (RGB/RGBA), already tonemapped/scaled by the app.
    - azimuth, zenith, roll: angles in degrees.

    Output
    - PIL image (RGB/RGBA), square, sized for the UI canvas (e.g., 512x512).
      This is the view shown in both the Orientation and Sky Aperture panes.

    Notes
    - Keep angle conventions consistent across all three functions.
    - Deterministic: same inputs => same output.
    """
    raise NotImplementedError


def sky_segment_impl(
    hemisphere_image: Image.Image,
    points: List[Point],
) -> Image.Image:
    """
    Segment the sky from the current oriented view using 3 user clicks.

    Inputs
    - hemisphere_image: the image returned by orientation_render_impl (same size as UI canvas).
    - points: list of 3 normalized points (x,y in [0,1]) inside the hemisphere.

    Output
    - PIL RGBA image, same size as `hemisphere_image`, where sky is opaque
      and non-sky is transparent (suitable for PNG preview/download).

    Notes
    - Typical approach: treat the 3 clicks as positive prompts for SAM.
    """
    raise NotImplementedError


def forecast_energy_impl(
    source_image: Image.Image,
    azimuth: float,
    zenith: float,
    roll: float,
    points: List[Point],
) -> Dict[str, Any]:
    """
    Compute an energy forecast using the image, orientation, and sky aperture.

    Inputs
    - source_image: original uploaded image (preview version from the app).
    - azimuth, zenith, roll: current orientation in degrees.
    - points: 3 normalized (x,y) clicks defining the sky aperture.

    Output (JSON-serializable dict)
    - Example:
      {
        "annual_kwh": 1523.4,
        "unit": "kWh",
        "model": "YourModelName",
        "site": {"lat": 35.9, "lon": -79.0},        # optional
        "assumptions": {"tilt_loss": 0.03, ...}    # optional
      }

    Notes
    - We can re-run our own segmentation internally if needed, or assume the
      3 points approximate the visible-sky region for shading/irradiance calc.
    """
    raise NotImplementedError
