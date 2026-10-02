"""Tests for the spatial export layers (one point per site, no scatter)."""
import io
import json
import os
import sqlite3
import sys
import zipfile
from collections import namedtuple
from datetime import date

# Add API service to path so we can import the modules directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


DepRow = namedtuple(
    "DepRow",
    "id camera_id camera_name site_id site_name deployment_number "
    "start_date end_date lon lat site_lon site_lat trap_days "
    "detection_count detection_rate_per_100",
)


def _dep_row(dep_id=1, site_id=10, camera_name="CAM-1", end=date(2026, 4, 10)):
    return DepRow(
        id=dep_id,
        camera_id=1,
        camera_name=camera_name,
        site_id=site_id,
        site_name=f"site {site_id}",
        deployment_number=1,
        start_date=date(2026, 1, 1),
        end_date=end,
        lon=5.01,
        lat=50.01,
        site_lon=5.0,
        site_lat=50.0,
        trap_days=100,
        detection_count=8,
        detection_rate_per_100=8.0,
    )


def _bucket(site_name="site 10", trap_days=100, species_counts=None,
            has_active=False, last_end=date(2026, 4, 10)):
    counts = species_counts if species_counts is not None else {"red deer": 5}
    return {
        "site_name": site_name,
        "lon": 5.0,
        "lat": 50.0,
        "trap_days": trap_days,
        "deployments": 2,
        "first": date(2026, 1, 1),
        "last_end": last_end,
        "has_active": has_active,
        "species_counts": counts,
        "detections": sum(counts.values()),
    }


TAXONOMY = {"Red Deer": {"scientific_name": "Cervus elaphus", "taxon_rank": "species"}}


def _build(deployment_rows=None, buckets=None, taxonomy=None):
    from routers.export import _build_spatial_layers

    return _build_spatial_layers(
        deployment_rows if deployment_rows is not None else [_dep_row()],
        buckets if buckets is not None else {10: _bucket()},
        taxonomy if taxonomy is not None else TAXONOMY,
    )


class TestBuildSpatialLayers:
    def test_three_layers_and_no_observation_scatter(self):
        layers = _build()
        assert set(layers) == {"deployments", "sites", "species_summary"}

    def test_sites_layer_one_point_per_site(self):
        layers = _build(buckets={
            10: _bucket(),
            11: _bucket(site_name="site 11", species_counts={"fox": 2}),
        })
        assert len(layers["sites"]) == 2
        p = layers["sites"][0]["properties"]
        assert p["site_id"] == 10
        assert p["deployment_count"] == 2
        assert p["trap_days"] == 100
        assert p["detection_count"] == 5
        assert p["detection_rate_per_100"] == 5.0
        assert p["first_date"] == "2026-01-01"
        assert p["last_date"] == "2026-04-10"

    def test_active_site_has_blank_last_date(self):
        layers = _build(buckets={10: _bucket(has_active=True)})
        assert layers["sites"][0]["properties"]["last_date"] == ""

    def test_richness_excludes_detector_categories(self):
        # person/vehicle/empty count as detections but never as species,
        # the same rule the Insights map uses
        layers = _build(buckets={10: _bucket(species_counts={
            "red deer": 5, "fox": 1, "person": 3, "vehicle": 1,
        })})
        p = layers["sites"][0]["properties"]
        assert p["species_richness"] == 2
        assert p["detection_count"] == 10

    def test_zero_trap_days_gives_zero_rate(self):
        layers = _build(buckets={10: _bucket(trap_days=0)})
        assert layers["sites"][0]["properties"]["detection_rate_per_100"] == 0.0

    def test_species_summary_matches_taxonomy_case_insensitively(self):
        # pool_map_rows lowercases species keys, the taxonomy table does not
        layers = _build(buckets={10: _bucket(species_counts={"red deer": 5})})
        rows = layers["species_summary"]
        assert len(rows) == 1
        p = rows[0]["properties"]
        assert p["species"] == "red deer"
        assert p["scientific_name"] == "Cervus elaphus"
        assert p["total_count"] == 5
        assert p["detection_rate_per_100"] == 5.0

    def test_deployments_layer_unchanged(self):
        layers = _build()
        p = layers["deployments"][0]["properties"]
        assert p["camera_id"] == "CAM-1"
        assert p["deployment_id"] == 1
        assert p["detection_rate_per_100"] == 8.0
        assert layers["deployments"][0]["lon"] == 5.01


class TestSerializers:
    def test_geojson_has_layer_property(self):
        from routers.export import _serialize_spatial_geojson

        doc = json.loads(_serialize_spatial_geojson(_build()))
        layer_names = {f["properties"]["layer"] for f in doc["features"]}
        assert layer_names == {"deployments", "sites", "species_summary"}

    def test_shapefile_fields_align_with_properties(self):
        # The zip must round-trip the sites layer through pyshp
        import shapefile

        from routers.export import _serialize_spatial_shapefile

        content = _serialize_spatial_shapefile(_build())
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = set(zf.namelist())
            for layer in ("deployments", "sites", "species_summary"):
                for ext in ("shp", "shx", "dbf", "prj"):
                    assert f"{layer}.{ext}" in names
            r = shapefile.Reader(
                shp=io.BytesIO(zf.read("sites.shp")),
                shx=io.BytesIO(zf.read("sites.shx")),
                dbf=io.BytesIO(zf.read("sites.dbf")),
            )
            rec = r.record(0)
            assert rec["site_id"] == 10
            assert rec["n_deploys"] == 2
            assert rec["det_count"] == 5
            assert rec["n_species"] == 1

    def test_geopackage_round_trips_sites(self):
        import tempfile

        from routers.export import _serialize_spatial_geopackage

        content = _serialize_spatial_geopackage(_build())
        with tempfile.NamedTemporaryFile(suffix=".gpkg") as tmp:
            tmp.write(content)
            tmp.flush()
            conn = sqlite3.connect(tmp.name)
            tables = {
                row[0] for row in
                conn.execute("SELECT table_name FROM gpkg_contents")
            }
            assert tables == {"deployments", "sites", "species_summary"}
            row = conn.execute(
                "SELECT site_id, deployment_count, detection_count, "
                "species_richness FROM sites"
            ).fetchone()
            conn.close()
        assert row == (10, 2, 5, 1)
