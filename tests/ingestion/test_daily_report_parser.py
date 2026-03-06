"""Tests for ingestion daily_report_parser helper functions."""
from datetime import datetime
from daily_report_parser import (
    parse_signal_quality,
    parse_temperature,
    parse_battery,
    parse_sd_card,
    parse_gps_decimal,
    parse_report_datetime,
)


class TestParseSignalQuality:
    def test_valid_value(self):
        assert parse_signal_quality("15") == 15

    def test_clamps_high(self):
        assert parse_signal_quality("50") == 31

    def test_clamps_low(self):
        assert parse_signal_quality("-5") == 0

    def test_none_input(self):
        assert parse_signal_quality(None) is None

    def test_non_numeric(self):
        assert parse_signal_quality("abc") is None


class TestParseTemperature:
    def test_with_celsius_symbol(self):
        assert parse_temperature("24℃") == 24

    def test_with_trailing_space(self):
        assert parse_temperature("24℃ ") == 24

    def test_none_input(self):
        assert parse_temperature(None) is None

    def test_non_numeric(self):
        assert parse_temperature("hot℃") is None


class TestParseBattery:
    def test_valid_percentage(self):
        assert parse_battery("60%") == 60

    def test_clamps_over_100(self):
        assert parse_battery("120%") == 100

    def test_none_input(self):
        assert parse_battery(None) is None


class TestParseSdCard:
    def test_normal_usage(self):
        # 59405 remaining / 59628 total -> ~0.37% used
        result = parse_sd_card("59405M/59628M")
        assert result is not None
        assert 0 < result < 1

    def test_half_used(self):
        result = parse_sd_card("500M/1000M")
        assert result == 50.0

    def test_zero_total(self):
        assert parse_sd_card("0M/0M") == 0.0

    def test_none_input(self):
        assert parse_sd_card(None) is None


class TestParseGpsDecimal:
    def test_valid_coordinates(self):
        result = parse_gps_decimal("52.098737,5.125504")
        assert result == (52.098737, 5.125504)

    def test_none_input(self):
        assert parse_gps_decimal(None) is None

    def test_invalid_format(self):
        assert parse_gps_decimal("not-gps") is None


class TestParseReportDatetime:
    def test_valid_datetime(self):
        result = parse_report_datetime("05/12/2025 15:46:47")
        assert result == datetime(2025, 12, 5, 15, 46, 47)

    def test_none_input(self):
        assert parse_report_datetime(None) is None

    def test_wrong_format(self):
        assert parse_report_datetime("2025-12-05 15:46:47") is None
