# Classification Worker

ML worker that classifies detected animals into species.

## Responsibilities

- Consume messages from `detection-complete` Redis queue
- Download animal crops from MinIO
- Run classification model (ResNet, EfficientNet, etc.)
- Predict species and confidence scores
- Insert classification records into database
- Generate thumbnails for web UI
- Save thumbnails to MinIO (`thumbnails` bucket)
- Publish to `classification-complete` queue

## Model Loading

Models are loaded from `/models/classification.pt` or downloaded from Hugging Face:

```python
from huggingface_hub import hf_hub_download

model_path = hf_hub_download(
    repo_id="your-org/classification-model",
    filename="model.pt"
)
```

## Configuration

Environment variables:
- `MODEL_CLASSIFICATION_PATH` - Path to model weights
- `USE_GPU` - Enable GPU inference (true/false)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `MINIO_ENDPOINT` - MinIO endpoint

## Running Locally

```bash
docker compose up classification
```
