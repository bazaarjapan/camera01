const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const detectionsEl = document.getElementById("detections");
const stageEl = document.getElementById("stage");
const mirrorToggleEl = document.getElementById("mirrorToggle");
const labelSelectEl = document.getElementById("labelSelect");
const confidenceRangeEl = document.getElementById("confidenceRange");
const confidenceValueEl = document.getElementById("confidenceValue");
const clearLockButtonEl = document.getElementById("clearLockButton");
const snapshotButtonEl = document.getElementById("snapshotButton");
const eventLogEl = document.getElementById("eventLog");
const snapshotGalleryEl = document.getElementById("snapshotGallery");

const COLORS = ["#ef6c2f", "#247e6e", "#2a6df4", "#da3a7b", "#a550e0"];
const AVAILABLE_LABELS = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
];

let model;
let isDetecting = false;
let animationFrameId;
let isMirrored = false;
let selectedLabel = "";
let activeTrack = null;
let minConfidence = 0.55;
let currentPredictions = [];
let isClickLocked = false;

const TRACK_SMOOTHING = 0.35;
const TRACK_KEEP_ALIVE_FRAMES = 8;
const LOCKED_COLOR = "#ffe45c";
const MAX_EVENT_LOG_ITEMS = 8;
const MAX_SNAPSHOT_ITEMS = 4;

function setStatus(message) {
  statusEl.textContent = message;
}

function addEventLog(message) {
  const timestamp = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const item = document.createElement("li");
  item.textContent = `${timestamp} ${message}`;
  eventLogEl.prepend(item);

  while (eventLogEl.children.length > MAX_EVENT_LOG_ITEMS) {
    eventLogEl.removeChild(eventLogEl.lastChild);
  }
}

function getNowLabel() {
  return new Date().toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateSnapshotGallery(dataUrl, caption) {
  const emptyState = snapshotGalleryEl.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }

  const item = document.createElement("figure");
  item.className = "snapshot-item";

  const image = document.createElement("img");
  image.src = dataUrl;
  image.alt = caption;

  const figcaption = document.createElement("figcaption");
  figcaption.className = "snapshot-caption";
  figcaption.textContent = caption;

  item.append(image, figcaption);
  snapshotGalleryEl.prepend(item);

  while (snapshotGalleryEl.children.length > MAX_SNAPSHOT_ITEMS) {
    snapshotGalleryEl.removeChild(snapshotGalleryEl.lastChild);
  }
}

function syncCanvasSize() {
  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  canvas.width = rect.width;
  canvas.height = rect.height;
}

function getCoverTransform() {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const targetWidth = canvas.width;
  const targetHeight = canvas.height;

  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return null;
  }

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (targetWidth - renderedWidth) / 2;
  const offsetY = (targetHeight - renderedHeight) / 2;

  return {
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    scale,
    offsetX,
    offsetY,
  };
}

function mapVideoBoxToCanvas(bbox) {
  const [x, y, width, height] = bbox;
  const transform = getCoverTransform();

  if (!transform) {
    return { x, y, width, height };
  }

  const mappedX = x * transform.scale + transform.offsetX;
  const mappedWidth = width * transform.scale;

  return {
    x: isMirrored ? transform.targetWidth - mappedX - mappedWidth : mappedX,
    y: y * transform.scale + transform.offsetY,
    width: mappedWidth,
    height: height * transform.scale,
  };
}

function mapCanvasPointToVideo(point) {
  const transform = getCoverTransform();

  if (!transform) {
    return point;
  }

  const effectiveX = isMirrored
    ? transform.targetWidth - point.x
    : point.x;

  return {
    x: (effectiveX - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

function drawVideoFrameToContext(targetCtx, targetCanvas) {
  const transform = getCoverTransform();

  if (!transform) {
    targetCtx.drawImage(video, 0, 0, targetCanvas.width, targetCanvas.height);
    return;
  }

  targetCtx.save();

  if (isMirrored) {
    targetCtx.translate(targetCanvas.width, 0);
    targetCtx.scale(-1, 1);
  }

  targetCtx.drawImage(
    video,
    transform.offsetX,
    transform.offsetY,
    transform.sourceWidth * transform.scale,
    transform.sourceHeight * transform.scale
  );

  targetCtx.restore();
}

function applyMirrorState() {
  stageEl.classList.toggle("is-mirrored", isMirrored);
}

function clearTrackLock({ keepLabel = true } = {}) {
  const hadLock = isClickLocked || Boolean(activeTrack);
  activeTrack = null;
  isClickLocked = false;

  if (!keepLabel) {
    selectedLabel = "";
    labelSelectEl.value = "";
  }

  if (hadLock) {
    addEventLog("Track lock cleared");
  }
}

function populateLabelOptions() {
  const options = ['<option value="">All objects</option>']
    .concat(
      AVAILABLE_LABELS.map(
        (label) => `<option value="${label}">${label}</option>`
      )
    )
    .join("");

  labelSelectEl.innerHTML = options;
}

function getBoxCenter(bbox) {
  const [x, y, width, height] = bbox;
  return {
    x: x + width / 2,
    y: y + height / 2,
  };
}

function getTrackDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function smoothBox(previousBox, nextBox) {
  if (!previousBox) {
    return nextBox;
  }

  return [
    lerp(previousBox[0], nextBox[0], TRACK_SMOOTHING),
    lerp(previousBox[1], nextBox[1], TRACK_SMOOTHING),
    lerp(previousBox[2], nextBox[2], TRACK_SMOOTHING),
    lerp(previousBox[3], nextBox[3], TRACK_SMOOTHING),
  ];
}

function chooseTrackedPrediction(predictions) {
  if (!selectedLabel) {
    activeTrack = null;
    return predictions;
  }

  const labelMatches = predictions.filter(
    (prediction) => prediction.class === selectedLabel
  );

  if (!labelMatches.length) {
    if (activeTrack && activeTrack.missedFrames < TRACK_KEEP_ALIVE_FRAMES) {
      activeTrack = {
        ...activeTrack,
        missedFrames: activeTrack.missedFrames + 1,
      };

      return [
        {
          class: activeTrack.label,
          score: activeTrack.score,
          bbox: activeTrack.smoothedBox,
        },
      ];
    }

    activeTrack = null;
    return [];
  }

  let bestPrediction = labelMatches[0];

  if (activeTrack) {
    const previousCenter = activeTrack.center;
    bestPrediction = labelMatches.reduce((best, candidate) => {
      const candidateDistance = getTrackDistance(
        previousCenter,
        getBoxCenter(candidate.bbox)
      );
      const bestDistance = getTrackDistance(
        previousCenter,
        getBoxCenter(best.bbox)
      );

      if (candidateDistance !== bestDistance) {
        return candidateDistance < bestDistance ? candidate : best;
      }

      return candidate.score > best.score ? candidate : best;
    }, labelMatches[0]);
  } else {
    bestPrediction = labelMatches.reduce((best, candidate) =>
      candidate.score > best.score ? candidate : best
    );
  }

  activeTrack = {
    label: bestPrediction.class,
    center: getBoxCenter(bestPrediction.bbox),
    score: bestPrediction.score,
    missedFrames: 0,
    smoothedBox: smoothBox(activeTrack?.smoothedBox, bestPrediction.bbox),
  };

  return [
    {
      ...bestPrediction,
      bbox: activeTrack.smoothedBox,
    },
  ];
}

function drawPredictions(predictions) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  predictions.forEach((prediction, index) => {
    const { x, y, width, height } = mapVideoBoxToCanvas(prediction.bbox);
    const isLockedPrediction =
      isClickLocked && selectedLabel && prediction.class === selectedLabel;
    const color = isLockedPrediction ? LOCKED_COLOR : COLORS[index % COLORS.length];
    const score = Math.round(prediction.score * 100);
    const label = isLockedPrediction
      ? `LOCKED ${prediction.class} ${score}%`
      : `${prediction.class} ${score}%`;

    ctx.save();
    if (isLockedPrediction) {
      ctx.shadowColor = "rgba(255, 228, 92, 0.55)";
      ctx.shadowBlur = 22;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = isLockedPrediction ? 5 : 3;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();

    if (isLockedPrediction) {
      const corner = Math.max(16, Math.min(width, height) * 0.16);
      const centerX = x + width / 2;
      const centerY = y + height / 2;

      ctx.strokeStyle = color;
      ctx.lineWidth = 4;

      ctx.beginPath();
      ctx.moveTo(x, y + corner);
      ctx.lineTo(x, y);
      ctx.lineTo(x + corner, y);
      ctx.moveTo(x + width - corner, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + corner);
      ctx.moveTo(x, y + height - corner);
      ctx.lineTo(x, y + height);
      ctx.lineTo(x + corner, y + height);
      ctx.moveTo(x + width - corner, y + height);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x + width, y + height - corner);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX - 16, centerY);
      ctx.lineTo(centerX + 16, centerY);
      ctx.moveTo(centerX, centerY - 16);
      ctx.lineTo(centerX, centerY + 16);
      ctx.stroke();
    }

    ctx.font = "16px 'Segoe UI', sans-serif";
    const textWidth = ctx.measureText(label).width;
    const textHeight = isLockedPrediction ? 32 : 28;
    const textY = Math.max(0, y - textHeight - 4);

    ctx.fillStyle = color;
    ctx.fillRect(x, textY, textWidth + 16, textHeight);

    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 8, textY + (isLockedPrediction ? 21 : 19));
  });
}

function boxContainsPoint(bbox, point) {
  const [x, y, width, height] = bbox;
  return (
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height
  );
}

function getNearestPrediction(point, predictions) {
  const containingPredictions = predictions.filter((prediction) =>
    boxContainsPoint(prediction.bbox, point)
  );

  const candidates = containingPredictions.length
    ? containingPredictions
    : predictions;

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, candidate) => {
    const candidateDistance = getTrackDistance(point, getBoxCenter(candidate.bbox));
    const bestDistance = getTrackDistance(point, getBoxCenter(best.bbox));

    if (candidateDistance !== bestDistance) {
      return candidateDistance < bestDistance ? candidate : best;
    }

    return candidate.score > best.score ? candidate : best;
  }, candidates[0]);
}

function handleStageClick(event) {
  if (!currentPredictions.length) {
    return;
  }

  const rect = stageEl.getBoundingClientRect();
  const clickPoint = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const clickedPrediction = getNearestPrediction(
    mapCanvasPointToVideo(clickPoint),
    currentPredictions
  );

  if (!clickedPrediction) {
    return;
  }

  selectedLabel = clickedPrediction.class;
  labelSelectEl.value = selectedLabel;
  isClickLocked = true;
  activeTrack = {
    label: clickedPrediction.class,
    center: getBoxCenter(clickedPrediction.bbox),
    score: clickedPrediction.score,
    missedFrames: 0,
    smoothedBox: clickedPrediction.bbox,
  };
  setStatus(`Locked on ${clickedPrediction.class}`);
  addEventLog(`Locked on ${clickedPrediction.class}`);
}

function saveSnapshot() {
  if (video.readyState < 2 || !canvas.width || !canvas.height) {
    setStatus("Snapshot failed: camera is not ready.");
    addEventLog("Snapshot failed");
    return;
  }

  const snapshotCanvas = document.createElement("canvas");
  snapshotCanvas.width = canvas.width;
  snapshotCanvas.height = canvas.height;
  const snapshotCtx = snapshotCanvas.getContext("2d");

  drawVideoFrameToContext(snapshotCtx, snapshotCanvas);
  snapshotCtx.drawImage(canvas, 0, 0);

  const timestampLabel = getNowLabel();
  const trackedLabel = selectedLabel || "all objects";
  const metadataLabel = `Target: ${trackedLabel} | ${timestampLabel}`;

  snapshotCtx.fillStyle = "rgba(19, 25, 36, 0.72)";
  snapshotCtx.fillRect(16, snapshotCanvas.height - 58, snapshotCanvas.width - 32, 42);
  snapshotCtx.fillStyle = "#fffef7";
  snapshotCtx.font = "16px 'Segoe UI', sans-serif";
  snapshotCtx.fillText(metadataLabel, 28, snapshotCanvas.height - 31);

  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dataUrl = snapshotCanvas.toDataURL("image/png");
  link.download = `camera-detection-${timestamp}.png`;
  link.href = dataUrl;
  link.click();

  setStatus("Snapshot saved");
  addEventLog("Snapshot saved");
  updateSnapshotGallery(dataUrl, metadataLabel);
}

function renderDetectionList(predictions) {
  if (!predictions.length) {
    detectionsEl.innerHTML = "<li>No objects detected.</li>";
    return;
  }

  detectionsEl.innerHTML = predictions
    .map((prediction) => {
      const confidence = Math.round(prediction.score * 100);
      return `<li><strong>${prediction.class}</strong> confidence ${confidence}%</li>`;
    })
    .join("");
}

async function detectFrame() {
  if (!model || video.readyState < 2) {
    animationFrameId = window.requestAnimationFrame(detectFrame);
    return;
  }

  if (isDetecting) {
    animationFrameId = window.requestAnimationFrame(detectFrame);
    return;
  }

  isDetecting = true;

  try {
    syncCanvasSize();
    const predictions = await model.detect(video, 10);
    currentPredictions = predictions.filter(
      (prediction) => prediction.score >= minConfidence
    );
    const trackedPredictions = chooseTrackedPrediction(currentPredictions);
    drawPredictions(trackedPredictions);
    renderDetectionList(trackedPredictions);
    setStatus(
      trackedPredictions.length
        ? selectedLabel
          ? isClickLocked
            ? `Locked on ${selectedLabel}`
            : `Tracking ${selectedLabel}`
          : `${trackedPredictions.length} object(s) detected`
        : selectedLabel
          ? `Waiting for ${selectedLabel}...`
          : "Detecting objects..."
    );
  } catch (error) {
    console.error(error);
    setStatus("Detection failed. Check the console for details.");
  } finally {
    isDetecting = false;
    animationFrameId = window.requestAnimationFrame(detectFrame);
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function bootstrap() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support camera access.");
    return;
  }

  try {
    setStatus("Loading COCO-SSD model...");
    addEventLog("Loading COCO-SSD model");
    model = await cocoSsd.load();

    setStatus("Starting camera...");
    addEventLog("Starting camera");
    await startCamera();

    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);
    populateLabelOptions();
    confidenceValueEl.textContent = `${Math.round(minConfidence * 100)}%`;
    mirrorToggleEl.addEventListener("change", (event) => {
      isMirrored = event.target.checked;
      applyMirrorState();
    });
    labelSelectEl.addEventListener("change", (event) => {
      selectedLabel = event.target.value;
      isClickLocked = false;
      activeTrack = null;
    });
    confidenceRangeEl.addEventListener("input", (event) => {
      minConfidence = Number(event.target.value) / 100;
      confidenceValueEl.textContent = `${event.target.value}%`;
      clearTrackLock({ keepLabel: true });
      addEventLog(`Minimum confidence set to ${event.target.value}%`);
    });
    clearLockButtonEl.addEventListener("click", () => {
      clearTrackLock({ keepLabel: false });
      setStatus("Track lock cleared");
    });
    snapshotButtonEl.addEventListener("click", saveSnapshot);
    stageEl.addEventListener("click", handleStageClick);
    applyMirrorState();

    setStatus("Camera started. Detecting objects...");
    addEventLog("Camera started");
    detectFrame();
  } catch (error) {
    console.error(error);
    setStatus(`Startup failed: ${error.message}`);
  }
}

window.addEventListener("beforeunload", () => {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId);
  }

  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }
});

bootstrap();
