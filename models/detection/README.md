# Detection Model Weights

Place your object detection model weights in this directory.

## Expected Files

- `detection.pt` - PyTorch model weights
- `detection.onnx` - ONNX format (optional)

## Model Sources

Models can be:
1. **Downloaded from Hugging Face** - Workers auto-download on startup
2. **Manually placed here** - For offline deployment

## Gitignore

This directory is gitignored. Model weights should NOT be committed to the repository.
Use Hugging Face or external storage for model distribution.

## Example

```bash
# Download model manually
wget https://huggingface.co/your-org/detection-model/resolve/main/model.pt -O detection.pt
```
