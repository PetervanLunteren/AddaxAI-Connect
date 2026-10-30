"""The model registry: one loaded model per catalog id, loaded on first use
and never dropped. Fake loaders stand in for the ML modules, so no torch."""
import registry
from registry import ModelRegistry, ensure_downloaded
from shared.classification_models import DEEPFAUNE_ID, SPECIESNET_ID, FIXED, SPECIESNET, get_model


class FakeLoaded:
    def __init__(self, model):
        self.model = model

    def classify(self, image_path, detections, project):
        return []


def _registry(monkeypatch, tmp_path, fail=()):
    calls = []

    def loader(model, model_dir, device):
        calls.append((model.id, str(model_dir), device))
        if model.id in fail:
            raise RuntimeError("boom")
        return FakeLoaded(model)

    monkeypatch.setattr(registry, "ensure_downloaded", lambda model, models_dir: tmp_path / model.id)
    reg = ModelRegistry("cpu", str(tmp_path), loaders={FIXED: loader, SPECIESNET: loader})
    return reg, calls


class TestGet:
    def test_loads_once_and_keeps(self, monkeypatch, tmp_path):
        reg, calls = _registry(monkeypatch, tmp_path)
        first = reg.get(DEEPFAUNE_ID)
        assert reg.get(DEEPFAUNE_ID) is first
        assert calls == [(DEEPFAUNE_ID, str(tmp_path / DEEPFAUNE_ID), "cpu")]
        assert reg.loaded == [DEEPFAUNE_ID]

    def test_routes_by_kind(self, monkeypatch, tmp_path):
        seen = {}
        monkeypatch.setattr(registry, "ensure_downloaded", lambda model, models_dir: tmp_path)
        reg = ModelRegistry("cpu", str(tmp_path), loaders={
            FIXED: lambda m, d, dev: seen.setdefault(m.id, "fixed"),
            SPECIESNET: lambda m, d, dev: seen.setdefault(m.id, "speciesnet"),
        })
        reg.get(DEEPFAUNE_ID)
        reg.get(SPECIESNET_ID)
        assert seen == {DEEPFAUNE_ID: "fixed", SPECIESNET_ID: "speciesnet"}
        assert reg.loaded == sorted([DEEPFAUNE_ID, SPECIESNET_ID])

    def test_unknown_model_raises(self, monkeypatch, tmp_path):
        reg, _ = _registry(monkeypatch, tmp_path)
        try:
            reg.get("nope")
        except KeyError:
            pass
        else:
            raise AssertionError("expected KeyError")


class TestFailedLoad:
    def test_is_not_retried_and_memory_is_trimmed(self, monkeypatch, tmp_path):
        reg, calls = _registry(monkeypatch, tmp_path, fail={DEEPFAUNE_ID})
        trims = []
        monkeypatch.setattr(registry, "release_freed_memory", lambda: trims.append(1))
        errors = []
        for _ in range(2):
            try:
                reg.get(DEEPFAUNE_ID)
            except RuntimeError as e:
                errors.append(str(e))
            else:
                raise AssertionError("expected RuntimeError")
        assert errors[0] == "boom", "the first image sees the real error"
        assert "boom" in errors[1] and "restart the worker" in errors[1]
        assert len(calls) == 1, "a failed model must not be loaded again"
        assert trims == [1], "the memory the failed load touched is handed back once"
        assert reg.loaded == []
        # another model still loads
        assert reg.get(SPECIESNET_ID) is not None


class TestLoadAll:
    def test_goes_on_past_a_failing_model(self, monkeypatch, tmp_path):
        reg, calls = _registry(monkeypatch, tmp_path, fail={DEEPFAUNE_ID})
        reg.load_all([DEEPFAUNE_ID, SPECIESNET_ID])
        assert reg.loaded == [SPECIESNET_ID]
        assert [c[0] for c in calls] == [DEEPFAUNE_ID, SPECIESNET_ID]


class TestEnsureDownloaded:
    def test_skips_the_download_when_the_revision_is_there(self, monkeypatch, tmp_path):
        model = get_model(DEEPFAUNE_ID)
        (tmp_path / model.id).mkdir()
        (tmp_path / model.id / registry.REVISION_MARKER).write_text(model.revision)
        monkeypatch.setattr(registry, "download_snapshot", lambda *a: (_ for _ in ()).throw(AssertionError("downloaded")))
        assert ensure_downloaded(model, str(tmp_path)) == tmp_path / model.id

    def test_downloads_the_pinned_revision_and_writes_the_marker(self, monkeypatch, tmp_path):
        model = get_model(DEEPFAUNE_ID)
        downloads = []

        def fake_download(repo_id, revision, local_dir):
            downloads.append((repo_id, revision, local_dir))
            (tmp_path / model.id).mkdir(parents=True, exist_ok=True)

        monkeypatch.setattr(registry, "download_snapshot", fake_download)
        model_dir = ensure_downloaded(model, str(tmp_path))
        assert downloads == [(model.hf_repo, model.revision, str(tmp_path / model.id))]
        assert (model_dir / registry.REVISION_MARKER).read_text() == model.revision

    def test_another_revision_is_replaced(self, monkeypatch, tmp_path):
        model = get_model(DEEPFAUNE_ID)
        (tmp_path / model.id).mkdir()
        (tmp_path / model.id / registry.REVISION_MARKER).write_text("old")
        downloads = []
        monkeypatch.setattr(registry, "download_snapshot", lambda *a: downloads.append(a))
        ensure_downloaded(model, str(tmp_path))
        assert len(downloads) == 1
