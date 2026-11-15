# ZoneWatch

ZoneWatch is an independent, AI-assisted proof of concept for industrial video review. It explores a practical question: **how can a reviewer quickly find moments when someone may have entered a marked area?**

**[Try the live demo](https://alhajj.nl/zonewatch)**

## What it does

- Analyzes an attributed sample video in the browser using a pretrained person detector.
- Lets the reviewer choose or draw a monitoring area.
- Flags possible entries with timestamps, so the reviewer can jump to the frame and mark the result.
- Processes the sample on the visitor's device. Review choices remain in the page and are cleared when it is reloaded.

The demo checks one frame per second and counts transitions from an unoccupied to an occupied area. An event is not necessarily an individual person: missed detections can split a visit into several events. It is a discussion prototype, not a safety system, and its accuracy has not been validated for industrial deployment. It does not use Axelera hardware or its SDK.

## Run locally

You need Python 3 and a modern browser. From the repository directory:

```sh
python3 serve.py
```

Open [http://localhost:8000](http://localhost:8000), then select **Analyze sample**. The included server supports the byte-range requests needed for video seeking. Press Ctrl+C to stop it. On the first run the model assets are loaded from the local server, and performance depends on the device.

## How it works

The interface is plain HTML, CSS and JavaScript. TensorFlow.js runs the COCO-SSD SSDLite MobileNet V2 model locally in the browser. A detected person's bounding-box center determines whether they are inside the marked area. The sample-only version in this repository mirrors the public demo; it does not accept uploads.

The model, TensorFlow.js libraries and sample footage are included so the demo can run without fetching them from a third-party service. See [NOTICE.md](NOTICE.md) for source, attribution, modifications and third-party license details. The sample video is adapted from Intel IoT DevKit footage under CC BY 4.0.
