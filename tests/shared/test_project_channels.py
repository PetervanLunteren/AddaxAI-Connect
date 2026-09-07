"""Tests for the project channel registry shared by the API and the coordinator."""
from shared.project_channels import (
    EARTHRANGER,
    LABELS,
    PROJECT_CHANNELS,
    SENSINGCLUES,
    project_channel_of,
)


class TestProjectChannelOf:
    def test_earthranger(self):
        assert project_channel_of(["earthranger"]) == EARTHRANGER

    def test_sensingclues(self):
        assert project_channel_of(["sensingclues"]) == SENSINGCLUES

    def test_personal_channels_give_none(self):
        assert project_channel_of(["email", "telegram"]) is None

    def test_none_and_empty_give_none(self):
        assert project_channel_of(None) is None
        assert project_channel_of([]) is None


class TestRegistry:
    def test_every_channel_has_a_label(self):
        assert set(LABELS) == set(PROJECT_CHANNELS)

    def test_the_two_channels(self):
        assert PROJECT_CHANNELS == {"earthranger", "sensingclues"}
