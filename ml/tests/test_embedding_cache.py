"""Image embeddings are encoded once per (model, photo, image bytes) and reused after that."""

import numpy as np
import pytest

from whereabout_ml.embedding_cache import (
    cached_image_embeddings,
    embedding_cache_path,
    image_digest,
)


class CountingEncoder:
    """Embeds an 'image' (a text file) from its bytes, and records every batch it encodes."""

    def __init__(self, name: str = "Fake-B/test", dim: int = 4) -> None:
        self.name = name
        self.dim = dim
        self.batches: list[list[str]] = []

    def encode_images(self, paths):
        self.batches.append([p.name for p in paths])
        rows = []
        for p in paths:
            seed = int.from_bytes(p.read_bytes()[:8].ljust(8, b"\0"), "little")
            v = np.random.default_rng(seed).normal(size=self.dim).astype(np.float32)
            rows.append(v / np.linalg.norm(v))
        return np.stack(rows)


@pytest.fixture
def images(tmp_path):
    out = []
    for pid in ("a", "b", "c"):
        path = tmp_path / "img" / f"{pid}.jpg"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(f"pixels of {pid}".encode())
        out.append(path)
    return out


def ids(paths):
    return [p.stem for p in paths]


def test_first_run_encodes_everything_in_one_batch(tmp_path, images):
    enc = CountingEncoder()
    vectors, stats = cached_image_embeddings(enc, ids(images), images, tmp_path / "cache")
    assert vectors.shape == (3, 4)
    assert (stats.reused, stats.encoded) == (0, 3)
    assert enc.batches == [["a.jpg", "b.jpg", "c.jpg"]]


def test_a_later_run_reuses_identical_vectors_and_encodes_only_new_photos(tmp_path, images):
    cache = tmp_path / "cache"
    first, _ = cached_image_embeddings(CountingEncoder(), ids(images[:2]), images[:2], cache)

    enc = CountingEncoder()
    vectors, stats = cached_image_embeddings(enc, ids(images), images, cache)
    assert enc.batches == [["c.jpg"]], "only the new photo is encoded"
    assert (stats.reused, stats.encoded) == (2, 1)
    np.testing.assert_array_equal(vectors[:2], first)  # bit-for-bit, so guesses don't move
    np.testing.assert_array_equal(vectors[2], CountingEncoder().encode_images([images[2]])[0])


def test_rows_keep_input_order_when_hits_and_misses_interleave(tmp_path, images):
    cache = tmp_path / "cache"
    cached_image_embeddings(CountingEncoder(), ["b"], [images[1]], cache)
    vectors, _ = cached_image_embeddings(CountingEncoder(), ids(images), images, cache)
    fresh = CountingEncoder().encode_images(images)
    np.testing.assert_array_equal(vectors, fresh)


def test_a_changed_image_is_encoded_again(tmp_path, images):
    cache = tmp_path / "cache"
    cached_image_embeddings(CountingEncoder(), ids(images), images, cache)
    images[0].write_bytes(b"a different picture")
    enc = CountingEncoder()
    _, stats = cached_image_embeddings(enc, ids(images), images, cache)
    assert enc.batches == [["a.jpg"]]
    assert (stats.reused, stats.encoded) == (2, 1)


def test_each_model_has_its_own_cache(tmp_path, images):
    cache = tmp_path / "cache"
    cached_image_embeddings(CountingEncoder("Fake-B/one"), ids(images), images, cache)
    other = CountingEncoder("Fake-B/two", dim=6)
    vectors, stats = cached_image_embeddings(other, ids(images), images, cache)
    assert vectors.shape == (3, 6)
    assert stats.encoded == 3


def test_a_damaged_cache_file_is_encoded_again(tmp_path, images):
    cache = tmp_path / "cache"
    enc = CountingEncoder()
    cached_image_embeddings(enc, ids(images), images, cache)
    broken = embedding_cache_path(cache, enc.name, "b", image_digest(images[1]))
    broken.write_bytes(b"not an npy file")
    wrong_size = embedding_cache_path(cache, enc.name, "c", image_digest(images[2]))
    np.save(wrong_size, np.ones(9, dtype=np.float32))

    again = CountingEncoder()
    vectors, stats = cached_image_embeddings(again, ids(images), images, cache)
    np.testing.assert_array_equal(vectors, CountingEncoder().encode_images(images))
    assert (stats.reused, stats.encoded) == (1, 2)
    # Both were rewritten, so a third run is all hits.
    _, stats = cached_image_embeddings(CountingEncoder(), ids(images), images, cache)
    assert stats.encoded == 0


def test_mismatched_ids_and_paths_are_an_error(tmp_path, images):
    with pytest.raises(ValueError, match="same length"):
        cached_image_embeddings(CountingEncoder(), ["a"], images, tmp_path / "cache")


def test_no_photos_encodes_nothing(tmp_path):
    enc = CountingEncoder()
    vectors, stats = cached_image_embeddings(enc, [], [], tmp_path / "cache")
    assert len(vectors) == 0 and stats.encoded == 0 and enc.batches == []
