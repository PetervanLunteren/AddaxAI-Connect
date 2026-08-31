"""
Tests for the ML device rule.

The case that matters is the last one: a server that asked for the GPU and
cannot see it must refuse to start, not fall back to the CPU in silence.
"""
import pytest

from shared.device import select_device


def test_default_is_cpu_whatever_the_hardware():
    assert select_device(False, False) == "cpu"
    assert select_device(False, True) == "cpu"


def test_gpu_when_asked_for_and_present():
    assert select_device(True, True) == "cuda"


def test_gpu_asked_for_but_absent_refuses_to_start():
    with pytest.raises(RuntimeError, match="USE_GPU is true but PyTorch sees no CUDA device"):
        select_device(True, False)
