"""Which models a new project can pick, from the worker's last report."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from shared.classification_models import CLASSIFICATION_MODELS, DEEPFAUNE_ID, SPECIESNET_ID
from shared.queue import HEARTBEAT_KEY_CLASSIFICATION, MODELS_KEY_CLASSIFICATION
from utils import model_availability as ma


class FakeRedis:
    def __init__(self, values):
        self.values = values

    def get(self, key):
        return self.values.get(key)


def _stub(monkeypatch, heartbeat_age_seconds=10, available_mb=6000, loaded=()):
    values = {}
    if heartbeat_age_seconds is not None:
        stamp = datetime.now(timezone.utc) - timedelta(seconds=heartbeat_age_seconds)
        values[HEARTBEAT_KEY_CLASSIFICATION] = stamp.isoformat()
    if available_mb is not None:
        values[MODELS_KEY_CLASSIFICATION] = json.dumps({"available_mb": available_mb, "loaded": list(loaded)})

    class FakeQueue:
        def __init__(self, name):
            self.client = FakeRedis(values)

    monkeypatch.setattr(ma, "RedisQueue", FakeQueue)


def _by_id(models):
    return {m.id: m for m in models}


class TestListModels:
    def test_lists_every_catalog_model(self, monkeypatch):
        _stub(monkeypatch)
        assert set(_by_id(ma.list_models())) == set(CLASSIFICATION_MODELS)

    def test_fits_follows_free_memory(self, monkeypatch):
        # DeepFaune is 1218 MB: needs 2 * 1218 + 1024 free. SpeciesNet is 224 MB.
        _stub(monkeypatch, available_mb=3000)
        models = _by_id(ma.list_models())
        assert models[SPECIESNET_ID].fits and models[SPECIESNET_ID].reason is None
        assert not models[DEEPFAUNE_ID].fits
        assert models[DEEPFAUNE_ID].reason == ma.NOT_ENOUGH_MEMORY

    def test_loaded_models_always_fit(self, monkeypatch):
        _stub(monkeypatch, available_mb=100, loaded=[DEEPFAUNE_ID])
        models = _by_id(ma.list_models())
        assert models[DEEPFAUNE_ID].fits and models[DEEPFAUNE_ID].loaded
        assert not models[SPECIESNET_ID].fits

    @pytest.mark.parametrize("age", [None, 16 * 60])
    def test_nothing_fits_when_the_worker_is_down(self, monkeypatch, age):
        _stub(monkeypatch, heartbeat_age_seconds=age, available_mb=100000, loaded=[DEEPFAUNE_ID])
        for model in ma.list_models():
            assert not model.fits
            assert model.reason == ma.WORKER_DOWN
            assert not model.loaded

    def test_fresh_heartbeat_without_a_report_counts_as_down(self, monkeypatch):
        _stub(monkeypatch, available_mb=None)
        assert all(m.reason == ma.WORKER_DOWN for m in ma.list_models())


class TestCheckModel:
    def test_none_when_it_fits(self, monkeypatch):
        _stub(monkeypatch, available_mb=10000)
        assert ma.check_model(CLASSIFICATION_MODELS[DEEPFAUNE_ID]) is None

    def test_reason_when_it_does_not(self, monkeypatch):
        _stub(monkeypatch, available_mb=100)
        assert ma.check_model(CLASSIFICATION_MODELS[DEEPFAUNE_ID]) == ma.NOT_ENOUGH_MEMORY
