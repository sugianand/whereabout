"""The scene-gate runner end to end with a stub encoder and pre-cached images: no network."""

import csv
import json

import numpy as np
import pytest

from whereabout_ml import run_scene_gate
from whereabout_ml.scene_gate import REASONS, REJECT_PROMPTS

DIM = len(REASONS) + 1


class StubEncoder:
    """Texts land on their reason's axis; an image's embedding is read from its file name."""

    name = "stub/none"

    def __init__(self, *args):
        self.args = args

    def encode_texts(self, texts):
        rows = []
        for t in texts:
            axis = next((j for j, r in enumerate(REASONS) if t in REJECT_PROMPTS[r]), DIM - 1)
            v = np.zeros(DIM)
            v[axis] = 1.0
            rows.append(v)
        return np.array(rows)

    def encode_images(self, paths):
        out = []
        for p in paths:
            axis = int(p.stem.rsplit("-", 1)[-1][-1]) if p.stem.startswith("img") else DIM - 1
            v = np.full(DIM, 0.1)
            v[axis] = 1.0
            out.append(v / np.linalg.norm(v))
        return np.array(out)


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


@pytest.fixture
def workspace(tmp_path):
    images = tmp_path / "images"
    images.mkdir()
    # catalog images look "good" (last axis); reject images sit on reason axes
    for name in ("c1", "c2", "c3", "img-people0", "img-indoor1", "img-text2"):
        (images / f"{name}.jpg").write_bytes(b"dummy")
    write_csv(
        tmp_path / "photos.csv",
        ["id", "image_url", "lat", "lon", "place", "country", "author", "license", "source_url"],
        [[c, f"https://x/{c}.jpg", 0, 0, "p", "JP", "a", "l", "s"] for c in ("c1", "c2", "c3")],
    )
    # rejects are cached under their reject key, so name the files accordingly
    for i, name in enumerate(("img-people0", "img-indoor1", "img-text2")):
        (images / f"{run_scene_gate.reject_key(f't{i}')}.jpg").write_bytes(b"dummy")
        (images / f"{name}.jpg").unlink()
    write_csv(
        tmp_path / "rejects.csv",
        ["title", "label", "image_url", "author", "license", "source_url"],
        [[f"t{i}", lab, f"https://x/r{i}.jpg", "a", "l", "s"] for i, lab in enumerate(REASONS[:3])],
    )
    return tmp_path


# Reject row i (title "t{i}") sits on reason axis i.
REJECT_AXIS = {run_scene_gate.reject_key(f"t{i}"): i for i in range(len(REASONS))}


def test_reject_key_is_stable_and_title_specific():
    assert run_scene_gate.reject_key("File:A.jpg") == run_scene_gate.reject_key("File:A.jpg")
    assert run_scene_gate.reject_key("File:A.jpg") != run_scene_gate.reject_key("File:B.jpg")


class ReasonEncoder(StubEncoder):
    """Catalog images look like good photos; reject images sit on their reason axis."""

    def encode_images(self, paths):
        out = []
        for p in paths:
            axis = REJECT_AXIS.get(p.stem, DIM - 1)
            v = np.full(DIM, 0.1)
            v[axis] = 1.0
            out.append(v / np.linalg.norm(v))
        return np.array(out)


def test_cli_end_to_end_writes_all_outputs(workspace, capsys):
    out = workspace / "out"
    code = run_scene_gate.main(
        [
            "--catalog",
            str(workspace / "photos.csv"),
            "--rejects",
            str(workspace / "rejects.csv"),
            "--images",
            str(workspace / "images"),
            "--out",
            str(out),
            "--model",
            "Stub:none",
        ],
        encoder_factory=ReasonEncoder,
    )
    assert code == 0
    for name in ("thresholds.json", "report.json", "report.md", "scores.csv"):
        assert (out / name).exists()

    th = json.loads((out / "thresholds.json").read_text())
    assert set(th["thresholds"]) == set(REASONS)
    assert th["model"] == "stub/none"
    assert th["max_false_reject"] == 0.0

    report = json.loads((out / "report.json").read_text())
    assert report["catalog"]["n"] == 3 and report["catalog"]["passed"] == 3
    assert report["rejects"]["people"]["caught_for_label"] == 1
    assert report["rejects"]["text"]["caught"] == 1

    rows = list(csv.DictReader((out / "scores.csv").open()))
    assert [r["set"] for r in rows] == ["catalog"] * 3 + ["reject"] * 3
    assert rows[3]["id"] == "t0"
    assert rows[3]["label"] == "people"
    assert set(rows[0]) == {"id", "set", "label", *REASONS}
    assert "of 3" in (out / "report.md").read_text()


def test_unknown_reject_label_is_an_error(workspace):
    write_csv(
        workspace / "rejects.csv",
        ["title", "label", "image_url", "author", "license", "source_url"],
        [["t", "blurry", "https://x/a.jpg", "a", "l", "s"]],
    )
    with pytest.raises(ValueError, match="blurry"):
        run_scene_gate.run(
            run_scene_gate.read_csv(workspace / "rejects.csv"),
            run_scene_gate.read_csv(workspace / "rejects.csv"),
            {},
            ReasonEncoder(),
            out=workspace / "o",
        )


def test_cache_images_uses_cache_and_reports_missing_urls(workspace):
    items = [("c1", "https://x/c1.jpg"), ("nourl", "")]
    paths, failed = run_scene_gate.cache_images(items, workspace / "images", pause_s=0)
    assert set(paths) == {"c1"}
    assert failed == {"nourl": "no image_url"}
