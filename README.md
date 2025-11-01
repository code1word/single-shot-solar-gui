# Single Shot Solar Forecast

A web-based GUI tool for processing hemispherical sky images and generating solar energy forecasts. Built with Flask and modern web technologies.

## Features

- Upload and process various image formats
- Interactive solar panel orientation adjustment
- Sky aperture selection with 3-point interface
- Solar energy forecasting based on image analysis
- Modern, responsive UI with step-by-step workflow

## Prerequisites

- Python 3.x
- Flask
- Pillow (PIL)

Optional dependencies for advanced file formats:

- `rawpy` (for DNG files)
- `opencv-python` (for EXR files)

## Setup

1. Clone the repository:

```bash
git clone https://github.com/code1word/single-shot-solar-gui.git
cd single-shot-solar-gui
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the development server:

```bash
python app.py
```

The application will be available at `http://localhost:8000`.
