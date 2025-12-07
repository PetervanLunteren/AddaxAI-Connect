# Detection Worker

ML worker that runs object detection on camera trap images.

## Responsibilities

- Consume messages from `image-ingested` Redis queue
- Download raw images from MinIO
- Run detection model (YOLO, Faster R-CNN, etc.)
- Extract bounding boxes and confidence scores
- Crop detected animals from images
- Save crops to MinIO (`crops` bucket)
- Insert detection records into database
- Publish to `detection-complete` queue

## Model Loading

Models are loaded from `/models/detection.pt` or downloaded from Hugging Face on startup:

```python
from huggingface_hub import hf_hub_download

model_path = hf_hub_download(
    repo_id="your-org/detection-model",
    filename="model.pt"
)
```

## Configuration

Environment variables:
- `MODEL_DETECTION_PATH` - Path to model weights
- `USE_GPU` - Enable GPU inference (true/false)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `MINIO_ENDPOINT` - MinIO endpoint

## Running Locally

```bash
docker compose up detection
```
