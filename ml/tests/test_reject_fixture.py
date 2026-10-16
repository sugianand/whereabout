import csv
import urllib.parse

from whereabout_ml import reject_fixture as rf

API = "https://example.test/api.php"


def page(title, *, mime="image/jpeg", license_="CC BY-SA 4.0", artist="Ann", pageid=None):
    return {
        "pageid": pageid or abs(hash(title)) % 10**6,
        "title": title,
        "imageinfo": [
            {
                "descriptionurl": f"https://commons.wikimedia.org/wiki/{title.replace(' ', '_')}",
                "thumburl": f"https://upload.test/{title[5:]}",
                "width": 800,
                "height": 600,
                "mime": mime,
                "sha1": "x",
                "extmetadata": {
                    "LicenseShortName": {"value": license_},
                    "Artist": {"value": artist},
                },
            }
        ],
    }


class FakeCommons:
    """Canned Commons API: category members (paged, 2 per page) and file info."""

    def __init__(self, categories, pages):
        self.categories = categories
        self.pages = {p["title"]: p for p in pages}
        self.urls = []

    def __call__(self, url):
        self.urls.append(url)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        if q.get("list") == "categorymembers":
            members = self.categories.get(q["cmtitle"], [])
            start = int(q.get("cmcontinue", 0))
            chunk = members[start : start + 2]
            out = {"query": {"categorymembers": [{"title": t} for t in chunk]}}
            if start + 2 < len(members):
                out["continue"] = {"cmcontinue": str(start + 2)}
            return out
        titles = q["titles"].split("|")
        return {"query": {"pages": [self.pages[t] for t in titles if t in self.pages]}}


ONE = {"people": ("Category:P",)}


def test_category_files_follows_continue_and_caps():
    http = FakeCommons({"Category:P": [f"File:{i}.jpg" for i in range(5)]}, [])
    assert rf.category_files("Category:P", API, 10, http) == [f"File:{i}.jpg" for i in range(5)]
    assert len([u for u in http.urls if "cmcontinue" in u]) == 2
    assert rf.category_files("Category:P", API, 3, http) == [f"File:{i}.jpg" for i in range(3)]


def test_license_and_mime_filtering():
    titles = ["File:ok.jpg", "File:nc.jpg", "File:none.jpg", "File:vec.svg", "File:vid.webm"]
    http = FakeCommons(
        {"Category:P": titles},
        [
            page("File:ok.jpg"),
            page("File:nc.jpg", license_="CC BY-NC 4.0"),
            page("File:none.jpg", license_=""),
            page("File:vec.svg", mime="image/svg+xml"),
            page("File:vid.webm", mime="video/webm"),
        ],
    )
    rows = rf.build_fixture(12, API, 330, http, categories=ONE)
    assert [r["title"] for r in rows] == ["File:ok.jpg"]


def test_author_required_unless_public_domain():
    http = FakeCommons(
        {"Category:P": ["File:a.jpg", "File:b.jpg"]},
        [page("File:a.jpg", artist=""), page("File:b.jpg", artist="", license_="CC0")],
    )
    rows = rf.build_fixture(12, API, 330, http, categories=ONE)
    assert [r["title"] for r in rows] == ["File:b.jpg"]


def test_per_label_cap_and_deterministic_order():
    titles = ["File:c.jpg", "File:a.png", "File:d.jpg", "File:b.jpg"]
    http = FakeCommons({"Category:P": titles}, [page(t) for t in titles])
    rows = rf.build_fixture(2, API, 330, http, categories=ONE)
    assert [r["title"] for r in rows] == ["File:a.png", "File:b.jpg"]
    again = rf.build_fixture(2, API, 330, http, categories=ONE)
    assert again == rows


def test_empty_category_is_fine_and_labels_are_kept():
    http = FakeCommons({"Category:Q": ["File:q.jpg"]}, [page("File:q.jpg")])
    cats = {"people": ("Category:Empty",), "text": ("Category:Q",)}
    rows = rf.build_fixture(5, API, 330, http, categories=cats)
    assert [(r["label"], r["title"]) for r in rows] == [("text", "File:q.jpg")]
    assert set(rf.LABEL_CATEGORIES) == {"people", "indoor", "text", "not_photo", "close_up"}


BUILD_FIXTURE = rf.build_fixture


def patch_cli(monkeypatch, http, categories):
    """Route the CLI's build_fixture through the fake Commons (its default http was bound at
    definition time) and record which labels it was asked for."""
    monkeypatch.setattr(rf, "LABEL_CATEGORIES", categories)
    asked = []

    def build(n, api, width, *, categories, exclude=()):
        asked.append(sorted(categories))
        return BUILD_FIXTURE(n, api, width, http, categories=categories, exclude=exclude)

    monkeypatch.setattr(rf, "build_fixture", build)
    return asked


def test_main_writes_csv_and_skips_a_complete_fixture(tmp_path, monkeypatch, capsys):
    http = FakeCommons({"Category:P": ["File:a.jpg"]}, [page("File:a.jpg", artist="<b>Ann</b>")])
    asked = patch_cli(monkeypatch, http, ONE)
    out = tmp_path / "d" / "rejects.csv"
    assert rf.main(["--out", str(out), "--per-label", "3", "--api-url", API]) == 0
    with out.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        assert tuple(reader.fieldnames) == rf.FIELDS
        (row,) = list(reader)
    assert row["author"] == "Ann" and row["license"] == "CC BY-SA 4.0"
    assert row["image_url"] == "https://upload.test/a.jpg"
    assert "people: 1" in capsys.readouterr().out
    before = out.read_text()
    assert rf.main(["--out", str(out)]) == 0
    assert out.read_text() == before
    assert asked == [["people"]]


def test_main_appends_rows_for_a_new_label_and_keeps_the_old_ones(tmp_path, monkeypatch):
    http = FakeCommons(
        {"Category:P": ["File:a.jpg"], "Category:B": ["File:a.jpg", "File:bird.jpg"]},
        [page("File:a.jpg"), page("File:bird.jpg")],
    )
    out = tmp_path / "rejects.csv"
    patch_cli(monkeypatch, http, ONE)
    assert rf.main(["--out", str(out), "--api-url", API]) == 0
    old = out.read_text()

    asked = patch_cli(monkeypatch, http, {**ONE, "close_up": ("Category:B",)})
    assert rf.main(["--out", str(out), "--api-url", API]) == 0
    assert asked == [["close_up"]]  # only the new label is fetched
    text = out.read_text()
    assert text.startswith(old)  # existing rows untouched, so other reasons' checks hold still
    with out.open(newline="", encoding="utf-8") as fh:
        rows = [(r["label"], r["title"]) for r in csv.DictReader(fh)]
    # File:a.jpg is already a "people" reject, so it is not reused for the new label.
    assert rows == [("people", "File:a.jpg"), ("close_up", "File:bird.jpg")]


def test_missing_labels_in_label_order():
    assert rf.missing_labels([{"label": "text"}, {"label": "people"}]) == [
        "indoor",
        "not_photo",
        "close_up",
    ]
    assert rf.missing_labels([{"label": r} for r in rf.LABEL_CATEGORIES]) == []
