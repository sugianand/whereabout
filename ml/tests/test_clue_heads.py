import numpy as np
import pytest

from whereabout_api.geo import LatLon
from whereabout_ml import clue_heads as ch
from whereabout_ml.calibration import geo_folds, log_softmax
from whereabout_ml.clues import CONCEPT_GROUPS, MIN_CLUE_PROBABILITY
from whereabout_ml.zeroshot import Clue, Guess


def world(n, rng):
    """`n` points spread over the inhabited latitudes."""
    return [LatLon(float(rng.uniform(-50, 65)), float(rng.uniform(-180, 180))) for _ in range(n)]


def informative(labels, classes, rng, dim=16, noise=0.3):
    """Embeddings whose first len(classes) dimensions say the class, plus noise."""
    x = rng.normal(0, noise, size=(len(labels), dim))
    for i, lab in enumerate(labels):
        x[i, classes.index(lab)] += 1.0
    return x


def test_fit_probe_reaches_the_optimum_of_its_loss():
    rng = np.random.default_rng(1)
    classes = ("a", "b", "c")
    y = rng.integers(0, 3, size=300)
    x = informative([classes[i] for i in y], list(classes), rng)
    l2 = 1e-2
    probe = ch.fit_probe(x, y, classes, l2, iterations=3000)
    # Gradient of mean cross-entropy + l2/2 |W|^2 at the fitted weights is ~0.
    xs = (x - probe.mean) / probe.scale
    p = np.exp(log_softmax(xs @ probe.weights + probe.bias))
    onehot = np.eye(3)[y]
    grad_w = xs.T @ (p - onehot) / len(y) + l2 * probe.weights
    grad_b = (p - onehot).mean(axis=0)
    assert np.abs(grad_w).max() < 1e-4 and np.abs(grad_b).max() < 1e-4
    assert (probe.probabilities(x).argmax(axis=1) == y).mean() > 0.95
    assert np.allclose(probe.probabilities(x).sum(axis=1), 1.0)


def test_fit_probe_rejects_bad_input():
    x = np.zeros((3, 2))
    with pytest.raises(ValueError):
        ch.fit_probe(x, np.array([0, 1]), ("a", "b"), 0.1)
    with pytest.raises(ValueError):
        ch.fit_probe(x, np.array([0, 1, 2]), ("a", "b"), 0.1)
    with pytest.raises(ValueError):
        ch.fit_probe(x, np.array([0, 1, 1]), ("a", "b"), 0.0)


def test_paired_accuracy_ci():
    assert ch.paired_accuracy_ci([True, False], [True, False]) == (0.0, 0.0, 0.0)
    assert ch.paired_accuracy_ci([True] * 5, [False] * 5) == (1.0, 1.0, 1.0)
    delta, lo, hi = ch.paired_accuracy_ci([True] * 60 + [False] * 40, [True] * 50 + [False] * 50)
    assert delta == pytest.approx(0.1) and lo < 0.1 < hi
    with pytest.raises(ValueError):
        ch.paired_accuracy_ci([True], [])


def test_cross_fitting_never_trains_on_the_game_photos_own_block():
    """Each reference is an exact copy of the game photo in its block, with that photo's label;
    nothing else is learnable. A probe that saw its own block would score 100%; held out, it can
    only guess."""
    rng = np.random.default_rng(7)
    game_points = world(400, rng)
    labels = rng.integers(0, 2, size=400)
    x_game = rng.normal(size=(400, 600))
    ref_points = list(game_points)
    x_ref = x_game.copy()
    # Control: with more dimensions than photos, a probe that may see the copies memorises them.
    seen = ch.fit_probe(x_ref, labels, ("l", "r"), 1e-3)
    assert (seen.probabilities(x_game).argmax(axis=1) == labels).mean() > 0.99
    fold_ref = geo_folds(ref_points)
    fold_game = geo_folds(game_points)
    predicted = ch.cross_fit_predictions(
        x_ref, labels, fold_ref, x_game, fold_game, np.ones(400, bool), ("l", "r"), 1e-3
    )
    assert (predicted >= 0).all()
    assert (predicted == labels).mean() < 0.65


def driving_world(rng, n_ref=600, n_game=200):
    classes = list(ch.DRIVING_SIDE.classes)
    ref_labels = [classes[i] for i in rng.integers(0, 2, size=n_ref)]
    game_labels = [classes[i] for i in rng.integers(0, 2, size=n_game)]
    return (
        informative(ref_labels, classes, rng),
        world(n_ref, rng),
        ref_labels,
        informative(game_labels, classes, rng),
        world(n_game, rng),
        game_labels,
    )


def test_a_head_that_reads_the_concept_beats_a_weak_baseline_and_ships():
    rng = np.random.default_rng(3)
    x_ref, p_ref, y_ref, x_game, p_game, y_game = driving_world(rng)
    result = ch.evaluate_head(
        ch.DRIVING_SIDE, x_ref, p_ref, y_ref, x_game, p_game, y_game, ["right"] * len(y_game)
    )
    assert result is not None
    assert result.head_accuracy > 0.9
    assert result.baseline_accuracy == pytest.approx(y_game.count("right") / len(y_game))
    assert result.ships and result.ci95[0] > 0
    assert result.l2 in ch.L2_GRID and result.n == 200 and result.references == 600
    record = result.as_dict("Fake/test")
    assert record["ships"] is True and record["clueGroup"] == "driving_side"
    assert record["baseline"] == "the driving side of the country Atlas guessed"


def test_a_head_no_better_than_a_perfect_baseline_does_not_ship():
    rng = np.random.default_rng(4)
    x_ref, p_ref, y_ref, x_game, p_game, y_game = driving_world(rng)
    result = ch.evaluate_head(ch.DRIVING_SIDE, x_ref, p_ref, y_ref, x_game, p_game, y_game, y_game)
    assert result is not None and result.baseline_accuracy == 1.0
    assert not result.ships


def test_unlabelled_rows_are_ignored_and_too_few_references_means_no_head():
    rng = np.random.default_rng(5)
    x_ref, p_ref, y_ref, x_game, p_game, y_game = driving_world(rng)
    y_game = [None] * 50 + y_game[50:]
    result = ch.evaluate_head(
        ch.DRIVING_SIDE, x_ref, p_ref, y_ref, x_game, p_game, y_game, ["left"] * len(y_game)
    )
    assert result is not None and result.n == 150
    few = [None] * (len(y_ref) - 10) + y_ref[-10:]
    assert (
        ch.evaluate_head(ch.DRIVING_SIDE, x_ref, p_ref, few, x_game, p_game, y_game, y_game) is None
    )
    one_class = ["left"] * len(y_ref)
    assert (
        ch.evaluate_head(ch.DRIVING_SIDE, x_ref, p_ref, one_class, x_game, p_game, y_game, y_game)
        is None
    )


def test_every_zero_shot_climate_option_maps_to_a_koppen_group():
    options = next(g for g in CONCEPT_GROUPS if g.name == "climate").options
    assert {label for label, _ in options} == set(ch.ZERO_SHOT_CLIMATE)
    assert set(ch.ZERO_SHOT_CLIMATE.values()) <= set(ch.CLIMATE_GROUP.classes)
    p = np.zeros(len(options))
    p[[label for label, _ in options].index("Desert")] = 1.0
    assert ch.zero_shot_climate_groups([p]) == ["Arid"]


def shipped_climate_head(probabilities_by_row):
    """A HeadResult whose probe returns fixed climate probabilities for rows 0, 1, ..."""
    k = len(ch.CLIMATE_GROUP.classes)
    logits = np.log(np.asarray(probabilities_by_row))
    probe = ch.Probe(
        ch.CLIMATE_GROUP.classes,
        mean=np.zeros(len(logits)),
        scale=np.ones(len(logits)),
        weights=logits,  # one-hot rows pick their own logits
        bias=np.zeros(k),
        l2=0.01,
    )
    return ch.HeadResult(ch.CLIMATE_GROUP, 10, 100, 0.8, 0.5, 0.4, 0.3, (0.1, 0.5), 0.01, probe)


def guess(*clues):
    return Guess(0.0, 0.0, "X", "FR", 0.5, (("FR", 0.5),), tuple(clues))


def test_a_shipping_head_writes_its_groups_clue_and_leaves_the_others():
    zero_shot = Clue("Desert", 0.7, "climate")
    other = Clue("Mountains", 0.9, "setting")
    head = shipped_climate_head([[0.05, 0.8, 0.05, 0.05, 0.05], [0.3, 0.3, 0.2, 0.1, 0.1]])
    out = ch.apply_heads([guess(other, zero_shot), guess(zero_shot)], np.eye(2), [head])
    assert out[0].clues == (other, Clue("Arid climate", pytest.approx(0.8), "climate"))
    # The head was unsure on the second photo: no climate clue, and the old one is gone too.
    assert out[1].clues == ()
    assert MIN_CLUE_PROBABILITY > 0.3


def test_a_head_that_does_not_ship_changes_nothing():
    head = shipped_climate_head([[0.05, 0.8, 0.05, 0.05, 0.05]])
    losing = ch.HeadResult(**{**head.__dict__, "ci95": (-0.1, 0.2)})
    g = guess(Clue("Desert", 0.7, "climate"))
    assert ch.apply_heads([g], np.eye(1), [losing]) == [g]


def test_labels_for_reads_empty_cells_and_missing_ids_as_unlabelled(tmp_path):
    path = tmp_path / "labels.csv"
    path.write_text("id,climate_group,driving_side\na,Arid,left\nb,,right\n")
    table = ch.load_labels(path)
    assert ch.labels_for(["a", "b", "c"], table, "climate_group") == ["Arid", None, None]
    assert ch.labels_for(["a", "b", "c"], table, "driving_side") == ["left", "right", None]
