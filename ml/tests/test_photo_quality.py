import csv
import urllib.parse
from pathlib import Path

import numpy as np
import pytest

from whereabout_ml import photo_quality as pq


def blur(a: np.ndarray, passes: int = 6) -> np.ndarray:
    a = a.astype(np.float64)
    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + p[1:-1, 1:-1]) / 5
    return a


def noise(seed: int = 0, size: int = 256) -> np.ndarray:
    return np.random.default_rng(seed).uniform(0, 255, (size, size))


def test_sharp_beats_blurred():
    img = noise()
    assert pq.sharpness(img)[0] > 20 * pq.sharpness(blur(img))[0]
    checker = (np.indices((128, 128)).sum(axis=0) % 2) * 255.0
    assert pq.sharpness(checker)[0] > 20 * pq.sharpness(blur(checker))[0]


def test_flat_is_zero():
    assert pq.sharpness(np.full((100, 100), 90.0)) == (0.0, 0.0)


def test_half_sharp_scores_high_on_p90():
    img = np.full((256, 256), 100.0)
    img[128:] = noise(1, 256)[128:]
    p90, glob = pq.sharpness(img)
    full_p90, _ = pq.sharpness(noise(1, 256))
    assert p90 > 0.8 * full_p90
    assert glob < p90


def test_analysis_url_both_branches():
    url = "https://thumb.wikimedia.org/x/thumb/a/Foo.jpg/1280px-Foo.jpg"
    big = pq.Size(4000, 3000, "https://upload.wikimedia.org/x/Foo.jpg")
    small = pq.Size(1500, 1000, "https://upload.wikimedia.org/x/Foo.jpg")
    assert pq.analysis_url(url, big).endswith("/Foo.jpg/1920px-Foo.jpg")
    assert pq.analysis_url(url, small) == small.url


def fake_api(widths: dict[str, int]):
    calls = []

    def get_json(url: str):
        calls.append(url)
        titles = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["titles"][0].split("|")
        return {
            "query": {
                "pages": [
                    {
                        "title": t,
                        "imageinfo": [
                            {"width": widths[t], "height": 100, "url": f"https://u/{t}.jpg"}
                        ],
                    }
                    for t in titles
                    if t in widths
                ]
            }
        }

    get_json.calls = calls
    return get_json


def test_fetch_sizes_batches_and_parses():
    titles = [f"File:{i}.jpg" for i in range(120)]
    api = fake_api({t: 3000 + i for i, t in enumerate(titles[:-1])})
    sizes = pq.fetch_sizes(titles, get_json=api)
    assert len(api.calls) == 3
    assert sizes["File:5.jpg"].width == 3005
    assert "File:119.jpg" not in sizes


def make_catalog(path: Path, names: list[str]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "image_url", "source_url"])
        for i, n in enumerate(names):
            w.writerow(
                [
                    f"p{i}",
                    f"https://thumb.wikimedia.org/t/{n}/1280px-{n}",
                    f"https://commons.wikimedia.org/wiki/File:{n}",
                ]
            )


def test_measure_writes_csv_and_summary(tmp_path):
    from PIL import Image

    names = ["a.jpg", "b.jpg", "c.jpg"]
    make_catalog(tmp_path / "c.csv", names)
    api = fake_api({"File:a.jpg": 3000, "File:b.jpg": 900, "File:c.jpg": 1500})
    imgs = {"a.jpg": noise(0), "b.jpg": blur(noise(1)), "c.jpg": noise(2)}

    def fetch(url: str, path: Path) -> bool:
        key = next(k for k in imgs if k in url)
        Image.fromarray(imgs[key].astype(np.uint8)).save(path, "JPEG", quality=100)
        return True

    rows = pq.measure(tmp_path / "c.csv", tmp_path / "cache", get_json=api, fetch=fetch)
    out = tmp_path / "q.csv"
    pq.write_quality(out, rows)
    with out.open() as fh:
        assert next(csv.reader(fh)) == ["id", "width", "height", "sharpness", "sharpness_global"]
    assert [r["id"] for r in rows] == ["p0", "p1", "p2"]
    text = pq.summarize(rows, n=2)
    sharp_part = text.split("### Lowest width")[0]
    assert sharp_part.index("p1:") < sharp_part.index("p0:") or "p0:" not in sharp_part
    width_part = text.split("### Lowest width")[1]
    assert width_part.index("p1:") < width_part.index("p2:")
    assert "p0:" not in width_part
    assert "3 photos measured" in text


def test_main_cli(tmp_path, monkeypatch):
    monkeypatch.setattr(pq, "measure", lambda *a, **k: [])
    assert pq.main(["--out", str(tmp_path / "q.csv"), "--cache", str(tmp_path)]) == 0
    assert (tmp_path / "q.csv").read_text().startswith("id,width")


def test_analysis_url_rejects_odd_url():
    with pytest.raises(ValueError):
        pq.analysis_url("https://x/y.jpg", pq.Size(5000, 10, "u"))
