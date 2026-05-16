#!/usr/bin/env python3
"""
Generate deterministic synthetic image/video samples for thumbnail benchmarks.

Outputs are under bench-results and are ignored by git.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results" / "thumbnail-samples"
IMAGES = OUT / "images"
VIDEOS = OUT / "videos"


IMAGE_GROUPS = [
    ("small", 24, 240, 180, "jpg"),
    ("exactish", 16, 480, 320, "jpg"),
    ("medium", 48, 1920, 1080, "jpg"),
    ("large", 24, 4000, 3000, "jpg"),
    ("portrait", 24, 1080, 1920, "jpg"),
    ("png", 16, 1200, 900, "png"),
]


VIDEO_GROUPS = [
    ("video_720p", 8, 1280, 720, 2),
    ("video_1080p", 4, 1920, 1080, 2),
]


def make_image(width: int, height: int, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 255, width, dtype=np.uint16)
    y = np.linspace(0, 255, height, dtype=np.uint16)[:, None]
    base = np.zeros((height, width, 3), dtype=np.uint8)
    base[..., 0] = (x + seed * 13) % 256
    base[..., 1] = (y + seed * 29) % 256
    base[..., 2] = ((x // 2) + (y // 2) + seed * 7) % 256
    noise = rng.integers(0, 32, size=(height, width, 3), dtype=np.uint8)
    arr = np.clip(base.astype(np.uint16) + noise.astype(np.uint16), 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def generate_images() -> list[dict[str, object]]:
    IMAGES.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    seed = 1000
    for group, count, width, height, ext in IMAGE_GROUPS:
        for idx in range(count):
            path = IMAGES / f"{group}_{idx:04d}.{ext}"
            if not path.exists():
                image = make_image(width, height, seed)
                if ext == "jpg":
                    image.save(path, quality=86, optimize=True)
                else:
                    image.save(path, optimize=True)
            manifest.append(
                {
                    "path": str(path),
                    "group": group,
                    "width": width,
                    "height": height,
                    "ext": ext,
                    "bytes": path.stat().st_size,
                }
            )
            seed += 1
    return manifest


def ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return True
    except Exception:
        return False


def generate_videos() -> list[dict[str, object]]:
    VIDEOS.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    if not ffmpeg_available():
        return manifest

    for group, count, width, height, seconds in VIDEO_GROUPS:
        for idx in range(count):
            path = VIDEOS / f"{group}_{idx:04d}.mp4"
            if not path.exists():
                hue = (idx * 37) % 360
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    f"testsrc2=size={width}x{height}:rate=30:duration={seconds}",
                    "-vf",
                    f"hue=h={hue * math.pi / 180}",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "24",
                    "-pix_fmt",
                    "yuv420p",
                    str(path),
                ]
                subprocess.run(cmd, check=True)
            manifest.append(
                {
                    "path": str(path),
                    "group": group,
                    "width": width,
                    "height": height,
                    "seconds": seconds,
                    "bytes": path.stat().st_size,
                }
            )
    return manifest


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    images = generate_images()
    videos = generate_videos()
    manifest = {
        "images": images,
        "videos": videos,
        "image_count": len(images),
        "video_count": len(videos),
        "image_bytes": sum(int(item["bytes"]) for item in images),
        "video_bytes": sum(int(item["bytes"]) for item in videos),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
