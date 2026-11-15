/* global tf, cocoSsd */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const video = $("video");
  const canvas = $("frame");
  const ctx = canvas.getContext("2d");
  const scene = $("scene");
  const run = $("run");
  const preset = $("zone-preset");
  const defaults = { x: 0.16, y: 0.18, w: 0.56, h: 0.70 };
  const fullFrame = { x: 0, y: 0, w: 1, h: 1 };
  const sampleSource = "./assets/sample.mp4";
  const minConfidence = 0.5;
  const maxSeconds = 30;

  let zone = { ...defaults };
  let detector = null;
  let modelPromise = null;
  let working = false;
  let cancelRequested = false;
  let frames = [];
  let events = [];
  let currentDetections = [];
  let dragStart = null;

  function setStatus(text, state = "idle") {
    $("status").textContent = text;
    $("status-pill").dataset.state = state;
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function setProgress(value, label) {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    $("progress-wrap").hidden = false;
    $("progress-label").textContent = label;
    $("progress-value").textContent = `${percent}%`;
    $("progress-bar").style.width = `${percent}%`;
    $("progress").setAttribute("aria-valuenow", String(percent));
  }

  function resetResults() {
    frames = [];
    events = [];
    currentDetections = [];
    $("frame-count").textContent = "—";
    $("event-count").textContent = "—";
    $("avg-time").textContent = "—";
    $("result-badge").textContent = "WAITING";
    $("event-total").textContent = "No analysis yet";
    $("empty").hidden = false;
    $("empty").querySelector("strong").textContent = "Start with the sample";
    $("empty").querySelector("p").textContent = "Possible entries will appear here with a timestamp. Select one to inspect it.";
    $("event-list").replaceChildren();
    $("progress-wrap").hidden = true;
    setStatus("Ready to start");
  }

  function setWorking(value) {
    working = value;
    preset.disabled = value;
    canvas.style.cursor = value ? "default" : "crosshair";
    $("scene-hint").textContent = value ? "Analyzing one frame per second" : "Drag on the image to adjust the area";
    $("run-label").textContent = value ? "Stop analysis" : "Analyze sample";
    run.disabled = false;
  }

  function drawFrame(detections = currentDetections) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.fillStyle = "rgba(150, 225, 99, 0.16)";
    ctx.strokeStyle = "#c4ff8d";
    ctx.lineWidth = Math.max(2, w / 360);
    ctx.setLineDash([Math.max(6, w / 90), Math.max(4, w / 140)]);
    ctx.fillRect(zone.x * w, zone.y * h, zone.w * w, zone.h * h);
    ctx.strokeRect(zone.x * w, zone.y * h, zone.w * w, zone.h * h);
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.max(13, Math.round(w / 58))}px system-ui, sans-serif`;
    for (const person of detections) {
      const [x, y, bw, bh] = person.bbox;
      const inside = isInside(person);
      ctx.strokeStyle = inside ? "#c4ff8d" : "#ffffff";
      ctx.lineWidth = Math.max(2, w / 380);
      ctx.strokeRect(x, y, bw, bh);
      const label = `Person ${Math.round(person.score * 100)}%`;
      const labelWidth = ctx.measureText(label).width + 12;
      const labelHeight = Math.max(20, w / 42);
      const labelY = Math.max(0, y - labelHeight);
      ctx.fillStyle = inside ? "#c4ff8d" : "#ffffff";
      ctx.fillRect(x, labelY, labelWidth, labelHeight);
      ctx.fillStyle = "#142019";
      ctx.fillText(label, x + 6, labelY + labelHeight * 0.72);
    }
    $("frame-time").textContent = formatTime(video.currentTime || 0);
  }

  function isInside(person) {
    const [x, y, w, h] = person.bbox;
    const centerX = (x + w / 2) / video.videoWidth;
    const centerY = (y + h / 2) / video.videoHeight;
    return centerX >= zone.x && centerX <= zone.x + zone.w && centerY >= zone.y && centerY <= zone.y + zone.h;
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function seekTo(seconds) {
    const target = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.05)));
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.015) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("The video did not respond while seeking.")), 12000);
      const onSeeked = () => finish();
      const onError = () => finish(new Error("The video could not be read."));
      function finish(error) {
        clearTimeout(timeout);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        if (error) reject(error); else resolve();
      }
      video.addEventListener("seeked", onSeeked, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.currentTime = target;
    });
  }

  function addEvent(time, people) {
    const event = { time, people, review: "Pending" };
    events.push(event);
    const item = document.createElement("li");
    item.className = "event-item";
    const jump = document.createElement("button");
    jump.type = "button";
    jump.textContent = formatTime(time);
    jump.setAttribute("aria-label", `Inspect event at ${formatTime(time)}`);
    jump.addEventListener("click", async () => {
      if (working) return;
      try {
        await seekTo(time);
        currentDetections = event.people;
        drawFrame();
        scene.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
    const description = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Person detected in area";
    const detail = document.createElement("small");
    const best = Math.max(...people.filter(isInside).map((person) => person.score));
    detail.textContent = `Model confidence: ${Math.round(best * 100)}% · Select time to inspect`;
    description.append(title, detail);
    const review = document.createElement("select");
    review.setAttribute("aria-label", `Review event at ${formatTime(time)}`);
    for (const value of ["Pending", "Looks correct", "Not correct"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      review.append(option);
    }
    review.addEventListener("change", () => { event.review = review.value; });
    item.append(jump, description, review);
    $("event-list").append(item);
    $("empty").hidden = true;
    $("event-total").textContent = `${events.length} ${events.length === 1 ? "moment" : "moments"} to review`;
  }

  async function getDetector() {
    if (detector) return detector;
    if (!modelPromise) {
      modelPromise = (async () => {
        if (!window.tf || !window.cocoSsd) throw new Error("The detector could not load. Refresh the page and try again.");
        await tf.ready();
        return cocoSsd.load({ base: "lite_mobilenet_v2", modelUrl: "./model/model.json" });
      })().catch((error) => { modelPromise = null; throw error; });
    }
    detector = await modelPromise;
    return detector;
  }

  async function analyze() {
    if (working) {
      cancelRequested = true;
      $("run-label").textContent = "Stopping…";
      run.disabled = true;
      return;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setStatus("Video is not ready", "error");
      return;
    }
    resetResults();
    cancelRequested = false;
    setWorking(true);
    setStatus("Loading detector…", "running");
    setProgress(0, "Loading the local detector");
    $("result-badge").textContent = "RUNNING";
    try {
      const model = await getDetector();
      if (cancelRequested) return;
      const count = Math.max(1, Math.ceil(Math.min(video.duration, maxSeconds)));
      let occupied = false;
      let sum = 0;
      setStatus("Analyzing video", "running");
      for (let i = 0; i < count; i++) {
        if (cancelRequested) break;
        await seekTo(i);
        const started = performance.now();
        const results = await model.detect(video, 20, minConfidence);
        const durationMs = performance.now() - started;
        if (cancelRequested) break;
        const people = results.filter((result) => result.class === "person");
        currentDetections = people;
        frames.push({ time: i, people, durationMs });
        sum += durationMs;
        const nowOccupied = people.some(isInside);
        if (nowOccupied && !occupied) addEvent(i, people);
        occupied = nowOccupied;
        drawFrame();
        $("frame-count").textContent = String(frames.length);
        $("event-count").textContent = String(events.length);
        $("avg-time").textContent = `${Math.round(sum / frames.length)} ms`;
        setProgress((i + 1) * 100 / count, `Checked ${i + 1} of ${count} frames`);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (cancelRequested) {
        setStatus("Analysis stopped");
        $("result-badge").textContent = "STOPPED";
        $("progress-label").textContent = `Stopped after ${frames.length} frames`;
      } else {
        setStatus("Analysis complete");
        $("result-badge").textContent = "COMPLETE";
        $("progress-label").textContent = `Finished · ${frames.length} frames checked`;
        if (!events.length) {
          $("empty").hidden = false;
          $("empty").querySelector("strong").textContent = "No possible entries detected";
          $("empty").querySelector("p").textContent = "Try another area. A clear result does not guarantee no one entered.";
          $("event-total").textContent = "No moments detected";
        }
      }
    } catch (error) {
      console.error(error);
      setStatus("Analysis could not finish", "error");
      $("result-badge").textContent = "ERROR";
      $("progress-label").textContent = error.message || "Please retry with a supported video.";
    } finally {
      if (cancelRequested && $("result-badge").textContent === "RUNNING") {
        setStatus("Analysis stopped");
        $("result-badge").textContent = "STOPPED";
        $("progress-label").textContent = "Stopped before analysis began";
      }
      setWorking(false);
    }
  }

  function loadSample() {
    resetResults();
    run.disabled = true;
    $("scene-placeholder").hidden = false;
    $("scene-placeholder").textContent = "Loading sample footage…";
    $("run-label").textContent = "Analyze sample";
    video.src = sampleSource;
    video.load();
  }

  function onVideoLoaded() {
    scene.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    $("scene-placeholder").hidden = true;
    run.disabled = false;
    setStatus("Ready to start");
    drawFrame([]);
  }
  video.addEventListener("loadeddata", onVideoLoaded);

  video.addEventListener("error", () => {
    $("scene-placeholder").hidden = false;
    $("scene-placeholder").textContent = "Could not open the sample. Refresh the page and try again.";
    setStatus("Video could not load", "error");
    run.disabled = true;
  });

  run.addEventListener("click", analyze);
  preset.addEventListener("change", () => {
    zone = preset.value === "all" ? { ...fullFrame } : { ...defaults };
    resetResults();
    drawFrame([]);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (working || video.readyState < 2) return;
    dragStart = pointFromEvent(event);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragStart || working) return;
    const point = pointFromEvent(event);
    zone = { x: Math.min(dragStart.x, point.x), y: Math.min(dragStart.y, point.y), w: Math.abs(point.x - dragStart.x), h: Math.abs(point.y - dragStart.y) };
    drawFrame([]);
  });
  function finishDrag(event) {
    if (!dragStart || working) return;
    dragStart = null;
    if (zone.w < 0.04 || zone.h < 0.04) {
      zone = { ...defaults };
      preset.value = "default";
    } else {
      preset.value = "custom";
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    resetResults();
    drawFrame([]);
  }
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  loadSample();
})();
