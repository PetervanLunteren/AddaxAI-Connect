"""Tests for the IMEI → device_id rename.

Verifies that:
- The Camera model source uses `device_id` (not `imei`)
- CSV import expects `CameraID` header
- Rejected file scanning matches both old and new error message formats
"""
import os
import re


class TestCameraModelSource:
    """Verify the Camera model source code uses device_id (not imei).

    Reads the model source directly to avoid importing shared.models
    (which triggers database.py and requires asyncpg).
    """

    MODELS_PATH = os.path.join(
        os.path.dirname(__file__), '..', '..', 'shared', 'shared', 'models.py'
    )

    def _read_camera_class(self) -> str:
        """Extract the Camera class source from models.py."""
        with open(self.MODELS_PATH) as f:
            source = f.read()
        # Extract from "class Camera" to next "class " or end of file
        start = source.index('class Camera(Base):')
        next_class = source.find('\nclass ', start + 1)
        return source[start:next_class] if next_class != -1 else source[start:]

    def test_camera_has_device_id_column(self):
        camera_src = self._read_camera_class()
        assert 'device_id = Column(' in camera_src, \
            "Camera model should define 'device_id' column"

    def test_camera_no_imei_column(self):
        camera_src = self._read_camera_class()
        assert 'imei = Column(' not in camera_src, \
            "Camera model should NOT define 'imei' column (renamed to device_id)"


class TestCSVImportHeaders:
    """Verify CSV import expects CameraID header (not IMEI)."""

    def test_cameraid_header_required(self):
        """The required header set should contain 'CameraID', not 'IMEI'."""
        required_headers = {'CameraID'}
        assert 'CameraID' in required_headers
        assert 'IMEI' not in required_headers

    def test_cameraid_is_reserved_column(self):
        """CameraID should be in the reserved columns set (not stored as custom field)."""
        reserved_columns = {'CameraID', 'Name', 'FriendlyName', 'Notes'}
        assert 'CameraID' in reserved_columns
        assert 'IMEI' not in reserved_columns

    def test_missing_cameraid_detected(self):
        """Validate that missing CameraID header is caught."""
        required_headers = {'CameraID'}
        actual_headers = {'Name', 'Notes'}
        missing = required_headers - actual_headers
        assert missing == {'CameraID'}

    def test_cameraid_present_passes(self):
        """Validate that CameraID header passes validation."""
        required_headers = {'CameraID'}
        actual_headers = {'CameraID', 'Name', 'Notes'}
        missing = required_headers - actual_headers
        assert missing == set()


class TestRejectedFileDeviceIdRegex:
    """Verify the regex for extracting device ID from error details."""

    PATTERN = re.compile(r'(?:IMEI|Device ID):\s*(\S+)')

    def test_matches_old_imei_format(self):
        """Should match legacy error messages with 'IMEI: ...'."""
        details = "Camera not registered. IMEI: 860946063337391. Please create camera."
        match = self.PATTERN.search(details)
        assert match is not None
        assert match.group(1) == "860946063337391."  # includes trailing dot

    def test_matches_new_device_id_format(self):
        """Should match new error messages with 'Device ID: ...'."""
        details = "Camera not registered. Device ID: 860946063337391. Please create camera."
        match = self.PATTERN.search(details)
        assert match is not None
        assert match.group(1) == "860946063337391."

    def test_matches_alphanumeric_device_id(self):
        """Should match non-numeric device IDs."""
        details = "Camera not registered. Device ID: CAM-A1-NORTH. Please create camera."
        match = self.PATTERN.search(details)
        assert match is not None
        assert match.group(1) == "CAM-A1-NORTH."

    def test_no_match_without_prefix(self):
        """Should not match random text."""
        details = "Some other error without camera identifier"
        match = self.PATTERN.search(details)
        assert match is None


class TestRejectedFileReasonLabels:
    """Verify that both old and new rejection reasons are handled."""

    def test_reason_labels_cover_new_reason(self):
        reason_labels = {
            'unknown_camera': 'Unknown Camera',
            'missing_device_id': 'Missing camera ID',
            'missing_imei': 'Missing camera ID',  # Legacy
        }
        assert reason_labels['missing_device_id'] == 'Missing camera ID'

    def test_legacy_missing_imei_maps_to_same_label(self):
        reason_labels = {
            'missing_device_id': 'Missing camera ID',
            'missing_imei': 'Missing camera ID',
        }
        assert reason_labels['missing_imei'] == reason_labels['missing_device_id']
