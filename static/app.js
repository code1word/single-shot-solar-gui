let uploadId = null;
let currentViewId = null;
let orientationEnabled = false;
let points = [];
let currentStep = 1;
let maxStepReached = 1; // track furthest progress

// Original image, chosen half, and source rect for drawing
let fullImg = null; // Image() of the uploaded file
let selectedHalf = null; // "left" | "right" | "full" | null (undecided)
let sourceRect = null; // { sx, sy, sw, sh } of chosen half (or full)

// Stepper / panes
const stepperEls = [...document.querySelectorAll(".stepper .step")];
const panes = [...document.querySelectorAll(".step-pane")];

// DOM refs
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");

const orientationCanvas = document.getElementById("orientationCanvas");
const oCtx = orientationCanvas.getContext("2d");
const renderingBadge = document.getElementById("renderingBadge");

const apertureCanvas = document.getElementById("apertureCanvas");
const aCtx = apertureCanvas.getContext("2d");
const pointsHint = document.getElementById("pointsHint");
const clearPointsBtn = document.getElementById("clearPoints");
const segmentBtn = document.getElementById("segmentBtn");

const azRange = document.getElementById("azimuth");
const azNum = document.getElementById("azimuthNum");
const zeRange = document.getElementById("zenith");
const zeNum = document.getElementById("zenithNum");
const roRange = document.getElementById("roll");
const roNum = document.getElementById("rollNum");

const nextFromUpload = document.getElementById("nextFromUpload");
const nextFromOrient = document.getElementById("nextFromOrient");
const nextFromAperture = document.getElementById("nextFromAperture");

const forecastBtn = document.getElementById("forecastBtn");
const forecastModal = document.getElementById("forecastModal");
const forecastContent = document.getElementById("forecastContent");
const closeForecast = document.getElementById("closeForecast");

const resultModal = document.getElementById("resultModal");
const resultImg = document.getElementById("resultImg");
const downloadLink = document.getElementById("downloadLink");
const closeModal = document.getElementById("closeModal");

// Dual-hemispherical info modal
const dualInfoBtn = document.getElementById("dualInfoBtn");
const dualInfoModal = document.getElementById("dualInfoModal");
const dualInfoClose = document.getElementById("dualInfoClose");

if (dualInfoBtn && dualInfoModal) {
  dualInfoBtn.addEventListener("click", () => dualInfoModal.showModal());
}
if (dualInfoClose && dualInfoModal) {
  dualInfoClose.addEventListener("click", () => dualInfoModal.close());
}

// Hemisphere picker dialog refs (image-only selection)
const hemiPicker = document.getElementById("hemispherePicker");
const hemiLeftCanvas = document.getElementById("hemiLeft");
const hemiRightCanvas = document.getElementById("hemiRight");
const hemiCancel = document.getElementById("hemiCancel");

// ---------------------- Helpers --------------------------------------------
function setStatus(msg, { loading = false } = {}) {
  uploadStatus.textContent = msg;
  uploadStatus.classList.toggle("loading", loading);
}

// Support optional srcRect to draw only the chosen half
function drawCircularImage(ctx, img, srcRect = null) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  ctx.clip();

  const s = srcRect || { sx: 0, sy: 0, sw: img.width, sh: img.height };
  const targetAspect = w / h;
  const srcAspect = s.sw / s.sh;

  let dw = w,
    dh = h;
  if (srcAspect > targetAspect) {
    dh = h;
    dw = dh * srcAspect;
  } else {
    dw = w;
    dh = dw / srcAspect;
  }
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx, dy, dw, dh);
  ctx.restore();
}

function clamp(v, mn, mx) {
  return Math.max(mn, Math.min(mx, v));
}

function syncPair(rangeEl, numEl) {
  rangeEl.addEventListener("input", () => {
    numEl.value = rangeEl.value;
    scheduleRender();
  });
  numEl.addEventListener("input", () => {
    const v = clamp(
      Number(numEl.value || 0),
      Number(numEl.min),
      Number(numEl.max)
    );
    numEl.value = v;
    rangeEl.value = v;
    scheduleRender();
  });
}

// Progress UI helpers
let progressWrap = null;
let progressBar = null;
let progressPct = null;

function ensureProgressUI() {
  if (progressWrap) return;
  progressWrap = document.createElement("div");
  progressWrap.className = "progress";
  progressBar = document.createElement("div");
  progressBar.className = "bar";
  progressPct = document.createElement("div");
  progressPct.className = "pct";
  progressPct.textContent = "0%";
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(progressPct);
}

function showProgress() {
  ensureProgressUI();
  if (!dropzone.contains(progressWrap)) dropzone.appendChild(progressWrap);
  dropzone.classList.add("uploading");
  setProgress(0);
}

function hideProgress() {
  dropzone.classList.remove("uploading");
  if (progressWrap && dropzone.contains(progressWrap)) {
    dropzone.removeChild(progressWrap);
  }
}

function setProgress(pct) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  if (progressBar) progressBar.style.width = `${v}%`;
  if (progressPct) progressPct.textContent = `${v}%`;
}

function showDoneBadge(text = "Uploaded") {
  const badge = document.createElement("div");
  badge.className = "done-badge";
  badge.innerHTML = `<i class="fa-solid fa-check"></i> ${text}`;
  dropzone.appendChild(badge);
  setTimeout(() => {
    if (dropzone.contains(badge)) dropzone.removeChild(badge);
  }, 2200);
}

// Helper to update both canvases using current selection/full
function drawPreviewToBoth() {
  if (!fullImg) return;
  const rect = sourceRect || {
    sx: 0,
    sy: 0,
    sw: fullImg.width,
    sh: fullImg.height,
  };
  drawCircularImage(oCtx, fullImg, rect);
  drawCircularImage(aCtx, fullImg, rect);
}

// ---------------------- Stepper --------------------------------------------
function updateStepper() {
  stepperEls.forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle("active", n === currentStep);
    s.classList.toggle("done", n < currentStep);

    // icon / number
    const dotSpan = s.querySelector(".dot span");
    if (dotSpan) {
      dotSpan.innerHTML =
        n < currentStep
          ? '<i class="fa-solid fa-check" aria-hidden="true"></i>'
          : String(n);
    }

    // allow clicking only to go BACK (n < currentStep)
    s.style.pointerEvents = n < currentStep ? "auto" : "none";
    s.tabIndex = n < currentStep ? 0 : -1;
    s.setAttribute("aria-disabled", n < currentStep ? "false" : "true");
  });
}

function goTo(step) {
  currentStep = step;
  maxStepReached = Math.max(maxStepReached, currentStep);
  panes.forEach((p) =>
    p.classList.toggle("active", Number(p.dataset.step) === step)
  );
  updateStepper();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Make stepper items clickable to go BACK
stepperEls.forEach((s) => {
  const n = Number(s.dataset.step);
  function tryGoBack() {
    if (n < currentStep) goTo(n);
  }
  s.addEventListener("click", tryGoBack);
  s.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && n < currentStep) {
      e.preventDefault();
      tryGoBack();
    }
  });
});

document
  .querySelectorAll("[data-back]")
  .forEach((btn) =>
    btn.addEventListener("click", () => goTo(Math.max(1, currentStep - 1)))
  );

// ---------------------- Upload (with progress) -----------------------------
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () =>
  dropzone.classList.remove("dragover")
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) handleUpload(file);
});
dropzone
  .querySelector("label")
  .addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleUpload(fileInput.files[0]);
});

async function handleUpload(file) {
  // Reset UI
  points = [];
  pointsHint.textContent = `Click 3 points (0/3)`;
  clearPointsBtn.disabled = true;
  segmentBtn.disabled = true;
  nextFromUpload.disabled = true;
  nextFromOrient.disabled = true;
  nextFromAperture.disabled = true;

  azRange.value = azNum.value = 0;
  zeRange.value = zeNum.value = 0;
  roRange.value = roNum.value = 0;

  // Reset image selection state
  fullImg = null;
  selectedHalf = null;
  sourceRect = null;

  // Visual uploading indicators
  setStatus(`Uploading ${file.name}…`, { loading: true });
  showProgress();

  const fd = new FormData();
  fd.append("file", file);

  // Use XHR for upload progress
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload");
  xhr.responseType = "json";

  xhr.upload.onprogress = (evt) => {
    if (evt.lengthComputable) {
      const pct = (evt.loaded / evt.total) * 100;
      setProgress(pct);
    }
  };

  xhr.onerror = () => {
    hideProgress();
    setStatus(`Error: Network error during upload`);
  };

  xhr.onload = () => {
    hideProgress();
    uploadStatus.classList.remove("loading");

    const data = xhr.response || {};
    if (xhr.status >= 400 || !data.ok) {
      setStatus(`Error: ${data.error || `HTTP ${xhr.status}`}`);
      return;
    }

    uploadId = data.upload_id;
    setStatus(`Uploaded: ${file.name}`);
    showDoneBadge("Upload complete");

    // Load the original image to allow client-side splitting + previews
    const img = new Image();
    img.onload = () => {
      fullImg = img;

      // Detect dual (~2:1). If not dual, lock to "full".
      const ratio = img.width / img.height;
      if (ratio < 1.9 || ratio > 2.1) {
        selectedHalf = "full";
        sourceRect = { sx: 0, sy: 0, sw: img.width, sh: img.height };
      } else {
        selectedHalf = null; // undecided; will ask on Next: Orient
        sourceRect = null;
      }

      // Show immediate preview (full if not dual, or full until user chooses)
      drawPreviewToBoth();

      nextFromUpload.disabled = false; // can proceed to orient (we intercept if dual)
      maxStepReached = Math.max(maxStepReached, 1);
      updateStepper();
      goTo(1); // stay on step 1 until user clicks next
      scheduleRender();
    };
    img.src = data.upload_url + "?v=" + Date.now();
  };

  xhr.send(fd);
}

// ---------------------- Orientation rendering ------------------------------
let renderTimer = null;
function scheduleRender() {
  if (!uploadId) return;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => doRender(), 100);
}

async function doRender() {
  renderingBadge.hidden = false;
  try {
    const body = {
      upload_id: uploadId,
      azimuth: Number(azRange.value),
      zenith: Number(zeRange.value),
      roll: Number(roRange.value),
      hemisphere: selectedHalf || "full", // pass user's choice to backend
    };
    const res = await fetch("/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Render failed");
    currentViewId = data.view_id;

    // For visual consistency, always draw from selected half of the original
    drawPreviewToBoth();

    renderingBadge.hidden = true;
    nextFromOrient.disabled = false;
    updateStepper();
  } catch (e) {
    console.error(e);
    renderingBadge.hidden = true;
  }
}

// ---------------------- Controls & keyboard nudges -------------------------
syncPair(azRange, azNum);
syncPair(zeRange, zeNum);
syncPair(roRange, roNum);
[azNum, zeNum, roNum].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      const step = e.shiftKey ? 10 : 1;
      el.value = Number(el.value) + step;
      el.dispatchEvent(new Event("input"));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      const step = e.shiftKey ? 10 : 1;
      el.value = Number(el.value) - step;
      el.dispatchEvent(new Event("input"));
    }
  });
});

// ---------------------- Aperture clicks ------------------------------------
apertureCanvas.addEventListener("click", (e) => {
  if (!uploadId) return;
  const rect = apertureCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top;
  const cx = apertureCanvas.width / 2,
    cy = apertureCanvas.height / 2;
  const r = Math.min(cx, cy);
  if (Math.hypot(x - cx, y - cy) > r) return;
  if (points.length >= 3) return;

  points.push({ x: x / apertureCanvas.width, y: y / apertureCanvas.height });
  drawPointsOverlay();
  pointsHint.textContent = `Click 3 points (${points.length}/3)`;
  clearPointsBtn.disabled = points.length === 0;
  segmentBtn.disabled = points.length !== 3;
  nextFromAperture.disabled = points.length !== 3;
});

function drawPointsOverlay() {
  // Base preview (selected half)
  if (fullImg) {
    drawCircularImage(aCtx, fullImg, sourceRect || undefined);
  } else {
    aCtx.drawImage(orientationCanvas, 0, 0);
  }
  aCtx.save();
  aCtx.fillStyle = "#ff6b6b";
  aCtx.strokeStyle = "#ff6b6b";
  aCtx.lineWidth = 2;
  const W = apertureCanvas.width,
    H = apertureCanvas.height;
  points.forEach((p) => {
    const x = p.x * W,
      y = p.y * H;
    aCtx.beginPath();
    aCtx.arc(x, y, 5, 0, Math.PI * 2);
    aCtx.fill();
  });
  if (points.length === 3) {
    aCtx.beginPath();
    aCtx.moveTo(points[0].x * W, points[0].y * H);
    aCtx.lineTo(points[1].x * W, points[1].y * H);
    aCtx.lineTo(points[2].x * W, points[2].y * H);
    aCtx.closePath();
    aCtx.stroke();
  }
  aCtx.restore();
}

clearPointsBtn.addEventListener("click", () => {
  points = [];
  pointsHint.textContent = `Click 3 points (0/3)`;
  clearPointsBtn.disabled = true;
  segmentBtn.disabled = true;
  nextFromAperture.disabled = true;
  if (fullImg) {
    drawCircularImage(aCtx, fullImg, sourceRect || undefined);
  } else {
    aCtx.drawImage(orientationCanvas, 0, 0);
  }
});

// ---------------------- Segmentation ---------------------------------------
segmentBtn.addEventListener("click", async () => {
  if (points.length !== 3 || !uploadId) return;
  segmentBtn.disabled = true;
  const prev = segmentBtn.textContent;
  segmentBtn.textContent = "Segmenting…";
  try {
    const res = await fetch("/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_id: uploadId,
        points,
        hemisphere: selectedHalf || "full",
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Segmentation failed");
    resultImg.src = data.sky_url + "?v=" + Date.now();
    downloadLink.href = data.sky_url;
    document.getElementById("resultModal").showModal();
  } catch (e) {
    alert(e.message);
  } finally {
    segmentBtn.textContent = prev;
    segmentBtn.disabled = false;
  }
});

closeModal.addEventListener("click", () =>
  document.getElementById("resultModal").close()
);

// ---------------------- Forecast -------------------------------------------
forecastBtn.addEventListener("click", async () => {
  if (!uploadId) return;
  forecastBtn.disabled = true;
  const prev = forecastBtn.innerHTML;
  forecastBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Forecasting...';
  try {
    const body = {
      upload_id: uploadId,
      azimuth: Number(azRange.value),
      zenith: Number(zeRange.value),
      roll: Number(roRange.value),
      points,
      hemisphere: selectedHalf || "full",
    };
    const res = await fetch("/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    // Fill dummy UI regardless (our engine will replace later)
    const az = Number(azRange.value).toFixed(0);
    const ze = Number(zeRange.value).toFixed(0);
    const ro = Number(roRange.value).toFixed(0);
    document.getElementById(
      "fc-orient"
    ).textContent = `az ${az}°, ze ${ze}°, roll ${ro}°`;

    // Simple dummy bars
    const barsWrap = document.getElementById("fc-monthly");
    barsWrap.innerHTML = "";
    const vals = Array.from({ length: 12 }, (_, i) =>
      Math.round(40 + 60 * Math.abs(Math.sin(((i + 1) / 12) * Math.PI)))
    );
    vals.forEach((v) => {
      const b = document.createElement("div");
      b.className = "bar";
      b.style.height = `${v * 1.3}px`;
      barsWrap.appendChild(b);
    });

    // Mask preview placeholder (optional)
    const mp = document.getElementById("maskPreview").getContext("2d");
    mp.clearRect(0, 0, 300, 300);
    mp.fillStyle = "#111";
    mp.beginPath();
    mp.arc(150, 150, 140, 0, Math.PI * 2);
    mp.fill();
    mp.fillStyle = "rgba(255,255,255,0.9)";
    mp.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto";
    mp.fillText("Sky mask preview", 80, 155);

    document.getElementById("forecastModal").showModal();

    // ignore errors for placeholder display
    if (!res.ok || !data.ok) {
      // Optionally: alert(data.error || `HTTP ${res.status}`);
    }
  } catch (e) {
    alert(`Forecast error: ${e.message}`);
  } finally {
    forecastBtn.innerHTML = prev;
    forecastBtn.disabled = false;
  }
});

closeForecast.addEventListener("click", () => forecastModal.close());

// ---------------------- Hemisphere picker logic ----------------------------
function paintHalfPreviews() {
  if (!fullImg || !hemiLeftCanvas || !hemiRightCanvas) return;

  const W = fullImg.width,
    H = fullImg.height;
  const halfW = Math.floor(W / 2);

  const lctx = hemiLeftCanvas.getContext("2d");
  lctx.clearRect(0, 0, hemiLeftCanvas.width, hemiLeftCanvas.height);
  drawImageContain(
    lctx,
    fullImg,
    { sx: 0, sy: 0, sw: halfW, sh: H },
    hemiLeftCanvas.width,
    hemiLeftCanvas.height
  );

  const rctx = hemiRightCanvas.getContext("2d");
  rctx.clearRect(0, 0, hemiRightCanvas.width, hemiRightCanvas.height);
  drawImageContain(
    rctx,
    fullImg,
    { sx: halfW, sy: 0, sw: W - halfW, sh: H },
    hemiRightCanvas.width,
    hemiRightCanvas.height
  );
}

// helper: draw a source rect fully visible (no crop), letterbox if needed
function drawImageContain(ctx, img, s, dw, dh) {
  ctx.save();
  ctx.clearRect(0, 0, dw, dh); // no fill box... avoids inner frame

  const srcAspect = s.sw / s.sh;
  const dstAspect = dw / dh;

  let drawW, drawH;
  if (srcAspect > dstAspect) {
    drawW = dw;
    drawH = drawW / srcAspect;
  } else {
    drawH = dh;
    drawW = drawH * srcAspect;
  }
  const dx = (dw - drawW) / 2;
  const dy = (dh - drawH) / 2;

  ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, dx, dy, drawW, drawH);
  ctx.restore();
}

function chooseHalf(which) {
  if (!fullImg) return;
  const W = fullImg.width,
    H = fullImg.height;
  const halfW = Math.floor(W / 2);

  if (which === "left") {
    selectedHalf = "left";
    sourceRect = { sx: 0, sy: 0, sw: halfW, sh: H };
  } else {
    selectedHalf = "right";
    sourceRect = { sx: halfW, sy: 0, sw: W - halfW, sh: H };
  }

  drawPreviewToBoth();
  if (hemiPicker) hemiPicker.close();
  scheduleRender();
}

function showHemispherePicker() {
  return new Promise((resolve) => {
    if (!hemiPicker) return resolve(); // if dialog absent, just continue

    paintHalfPreviews();
    hemiPicker.showModal();

    const onLeftClick = () => {
      cleanup();
      chooseHalf("left");
      resolve();
    };
    const onRightClick = () => {
      cleanup();
      chooseHalf("right");
      resolve();
    };
    const onCancel = () => {
      cleanup();
      hemiPicker.close();
      resolve();
    };

    // Images are the selectors
    hemiLeftCanvas && hemiLeftCanvas.addEventListener("click", onLeftClick);
    hemiRightCanvas && hemiRightCanvas.addEventListener("click", onRightClick);

    // Cancel button (if present)
    hemiCancel && hemiCancel.addEventListener("click", onCancel);

    // Close with ESC or backdrop
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }
    function onBackdropClose(e) {
      if (e.target === hemiPicker) onCancel();
    }
    document.addEventListener("keydown", onKey);
    hemiPicker.addEventListener("click", onBackdropClose);

    function cleanup() {
      hemiLeftCanvas &&
        hemiLeftCanvas.removeEventListener("click", onLeftClick);
      hemiRightCanvas &&
        hemiRightCanvas.removeEventListener("click", onRightClick);
      hemiCancel && hemiCancel.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKey);
      hemiPicker.removeEventListener("click", onBackdropClose);
    }
  });
}

// ---------------------- Next buttons (forward only) ------------------------
nextFromUpload?.addEventListener("click", async () => {
  // If image is dual-like and user hasn't chosen a half, prompt now
  if (fullImg && selectedHalf === null) {
    const ratio = fullImg.width / fullImg.height; // Heuristic: width:height ≈ 2:1
    if (ratio >= 1.9 && ratio <= 2.1) {
      await showHemispherePicker();
      if (selectedHalf === null) return; // user canceled
    } else {
      // Not dual; force full
      selectedHalf = "full";
      sourceRect = { sx: 0, sy: 0, sw: fullImg.width, sh: fullImg.height };
      drawPreviewToBoth();
    }
  }
  maxStepReached = Math.max(maxStepReached, 2);
  goTo(2);
  scheduleRender();
});

nextFromOrient?.addEventListener("click", () => {
  maxStepReached = Math.max(maxStepReached, 3);
  goTo(3);
});

nextFromAperture?.addEventListener("click", () => {
  maxStepReached = Math.max(maxStepReached, 4);
  goTo(4);
});

// ---------------------- Init ----------------------------------------------
updateStepper();
goTo(1);
