"""
One rule for which device an ML worker runs on.

The three workers that hold a model (detection, classification-deepfaune,
classification-speciesnet) each pick a device once at startup. The rule is
the same for all of them and lives here so it cannot drift:

- USE_GPU false (the default): cpu, always. A server that never set the
  variable behaves exactly as before.
- USE_GPU true and PyTorch sees a CUDA device: cuda.
- USE_GPU true and PyTorch sees nothing: refuse to start.

Refusing is the point. USE_GPU is set by docker-compose.gpu.yml, which ansible
applies when the operator put use_gpu true in host_vars, so it means "this
server has a GPU and the pipeline must use it". When the container cannot see
the card (no NVIDIA container runtime, a host driver older than the CUDA build
in the image, a driver update waiting for its reboot), a quiet fallback to CPU
would keep images flowing at a twentieth of the speed and nobody would be told.
A crash-looping worker stops stamping its heartbeat, so the existing liveness
alert reports it within the hour.

The function takes `cuda_available` as an argument instead of importing torch,
so the rule is testable without torch and the API and notification services,
which also import shared, never pull torch in.
"""


def select_device(use_gpu: bool, cuda_available: bool) -> str:
    """Return "cpu" or "cuda", or raise when the GPU was asked for and is absent."""
    if not use_gpu:
        return "cpu"
    if cuda_available:
        return "cuda"
    raise RuntimeError(
        "USE_GPU is true but PyTorch sees no CUDA device. On the host, check "
        "that `nvidia-smi` works and reports driver 580 or newer (the images "
        "carry CUDA 13), that the NVIDIA container toolkit is installed, and "
        "that COMPOSE_FILE in .env includes docker-compose.gpu.yml. To run on "
        "the CPU instead, set use_gpu false and re-run the playbook. See "
        "docs/deployment.md."
    )
