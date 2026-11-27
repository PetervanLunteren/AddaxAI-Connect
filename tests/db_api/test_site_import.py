"""Sites from a CSV file: which rows are taken and why the others are not."""
import pytest

from deployment_db import HOME, make_project, make_site, rows
from routers.sites import import_sites_csv

pytestmark = pytest.mark.asyncio


class Upload:
    """What the route reads of an uploaded file."""
    def __init__(self, text: str, filename: str = "sites.csv"):
        self.filename, self._text = filename, text

    async def read(self) -> bytes:
        return self._text.encode("utf-8")


async def test_sites_from_a_csv(session, admin):
    project = make_project()
    make_site(project, "Pond", HOME)
    csv_text = (
        "Name;Latitude;Longitude;Notes\n"
        "Ridge;53.27;5.19;on the dike\n"
        "Pond;53.26;5.18;\n"           # the name is taken
        "ridge;53.28;5.20;\n"          # the name is taken by the row above
        "Marsh;north;5.21;\n"          # not a number
        "Heath;95;5.22;\n"             # out of range
        ";53.2;5.2;\n"                 # no name
    )
    result = await import_sites_csv(project, Upload(csv_text), admin, session)

    assert (result.success_count, result.failed_count) == (1, 5)
    assert [r.success for r in result.results] == [True, False, False, False, False, False]
    assert result.results[1].row_number == 3 and "already exists" in result.results[1].error
    [ridge] = rows("SELECT name, notes, ST_Y(location::geometry) AS lat FROM sites WHERE name = 'Ridge'")
    assert ridge["notes"] == "on the dike" and abs(ridge["lat"] - 53.27) < 1e-9
    assert len(rows("SELECT 1 FROM sites")) == 2
