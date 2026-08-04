"""
scripts/restore.sh must retry a mirror that fails for a transient reason.

A restore pulls tens of thousands of objects over the public internet. One
dropped connection used to abort the whole run, leaving a half-populated
server: the database restored, raw-images complete, thumbnails half copied,
and the api never restarted. backup.sh had already been hardened with --retry
and nobody carried that across to the restore side.

These tests lift mirror_if_present straight out of the script and run it
against a fake mc, so they exercise the real code rather than a copy of it.
No docker, no network, no database.
"""
import re
import subprocess
import textwrap
from pathlib import Path

import pytest

RESTORE_SH = Path(__file__).resolve().parents[2] / "scripts" / "restore.sh"


def extract_mirror_helper() -> str:
    """Pull the retry settings and mirror_if_present out of restore.sh."""
    text = RESTORE_SH.read_text()
    start = text.index("MIRROR_ATTEMPTS=")
    # The function is the only block in this region that closes on a bare "}".
    end = text.index("\n}\n", start) + len("\n}\n")
    return text[start:end]


def run_harness(fake_mc_body: str, tmp_path) -> subprocess.CompletedProcess:
    """
    Run mirror_if_present with a stubbed docker/mc, log, die and sleep.

    `fake_mc_body` is bash that stands in for the mc invocation and sees the
    attempt number in $ATTEMPT. The counter lives in a file because the real
    function captures mc's output with $(...), which runs the stub in a
    subshell where a plain variable would not survive.
    """
    counter = tmp_path / "attempts"
    counter.write_text("0")

    script = textwrap.dedent(
        f"""
        set -uo pipefail
        COUNTER="{counter}"
        log() {{ echo "LOG: $*"; }}
        die() {{ echo "DIE: $*"; exit 9; }}
        sleep() {{ echo "SLEPT: $1"; }}   # keep the test fast
        docker() {{
          ATTEMPT=$(( $(cat "$COUNTER") + 1 ))
          echo "$ATTEMPT" > "$COUNTER"
          {fake_mc_body}
        }}

        {extract_mirror_helper()}

        MIRROR_BACKOFF_S=0
        mirror_if_present "test-bucket" "src" "dst"
        echo "RESULT: $?"
        echo "ATTEMPTS: $(cat "$COUNTER")"
        """
    )
    result = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=60
    )
    # Surface the attempt count even when the script died before printing it.
    result.attempts = int(counter.read_text().strip())  # type: ignore[attr-defined]
    return result


def mirror_invocations() -> list[str]:
    """The real mc mirror command lines, not the prose that mentions them."""
    return re.findall(r"docker compose exec[^\n]*mc mirror[^\n]*", RESTORE_SH.read_text())


class TestMirrorRetry:
    def test_transient_failure_is_retried_and_succeeds(self, tmp_path):
        # Fails once with the exact error seen in the real restore, then works.
        result = run_harness(
            'if [ "$ATTEMPT" -lt 2 ]; then\n'
            '  echo "mc: <ERROR> Failed to copy. Connection closed by foreign host. Retry again."\n'
            "  return 1\n"
            "fi\n"
            'echo "ok"\n'
            "return 0",
            tmp_path,
        )
        assert "DIE:" not in result.stdout, result.stdout
        assert "RESULT: 0" in result.stdout
        assert result.attempts == 2
        assert "Mirrored test-bucket" in result.stdout

    def test_it_gives_up_after_the_configured_attempts(self, tmp_path):
        result = run_harness(
            'echo "mc: <ERROR> Failed to copy. Connection closed by foreign host."\n'
            "return 1",
            tmp_path,
        )
        assert "DIE:" in result.stdout
        assert "failed after 4 attempts" in result.stdout
        assert result.attempts == 4
        assert result.returncode == 9

    def test_an_empty_prefix_is_skipped_not_retried(self, tmp_path):
        # crops, models and project-images are legitimately empty in the backup
        # of a young server. That must not cost four attempts and a failure.
        result = run_harness(
            'echo "mc: <ERROR> Unable to stat source. Object does not exist."\n'
            "return 1",
            tmp_path,
        )
        assert "DIE:" not in result.stdout, result.stdout
        assert "RESULT: 0" in result.stdout
        assert result.attempts == 1
        assert "holds nothing under this prefix" in result.stdout

    def test_the_error_report_is_not_the_entire_object_listing(self, tmp_path):
        # mc prints a line per object. The old version put all of it in the
        # error message, which buried the actual cause under 35000 lines.
        noise = "\n".join(f'echo "copied object-{i}"' for i in range(200))
        result = run_harness(
            noise + '\necho "mc: <ERROR> the real problem"\nreturn 1',
            tmp_path,
        )
        assert "DIE:" in result.stdout
        die_line = next(l for l in result.stdout.splitlines() if l.startswith("DIE:"))
        assert "the real problem" in die_line
        assert "object-100" not in die_line


class TestMirrorFlags:
    def test_restore_asks_mc_to_retry_each_object(self):
        calls = mirror_invocations()
        assert calls, "no mc mirror invocation found in restore.sh"
        for call in calls:
            assert "--retry" in call, f"mirror call without --retry: {call}"

    def test_restore_does_not_skip_errors(self):
        # backup.sh uses --skip-errors on purpose: a backup missing one object
        # still beats no backup. A restore missing one image is a hole in the
        # server, so the restore must not inherit that flag.
        for call in mirror_invocations():
            assert "--skip-errors" not in call, (
                f"restore must not skip errors, it would hide missing data: {call}"
            )


@pytest.mark.parametrize("name", ["MIRROR_ATTEMPTS", "MIRROR_BACKOFF_S"])
def test_retry_settings_are_declared(name):
    assert re.search(rf"^{name}=\d+", RESTORE_SH.read_text(), re.M)
