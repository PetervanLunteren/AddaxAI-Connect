# MinIO Presigned URL Signature Validation Issue

## Summary

Image thumbnails were not loading in the frontend due to AWS S3 signature validation failures when using boto3-generated presigned URLs with MinIO through an nginx reverse proxy.

## Problem Description

When attempting to serve image thumbnails from MinIO using boto3-generated presigned URLs, all requests failed with `SignatureDoesNotMatch` errors, even though:
- MinIO credentials were correct
- Basic MinIO operations (list buckets, list objects) worked
- The presigned URLs appeared correctly formatted

## Root Cause

AWS S3 v4 signatures include the `Host` header in the signature calculation. The signature mismatch occurred because:

1. **Boto3 generates URLs** with signature calculated for `Host: minio:9000` (internal Docker hostname)
2. **URL replacement** changes `http://minio:9000/...` to `https://dev.addaxai.com/minio/...`
3. **Browser requests** go to `https://dev.addaxai.com/minio/...`
4. **Nginx proxies** to `localhost:9000` with modified Host header
5. **MinIO validates** the signature against the received Host header
6. **Validation fails** because the Host header in the request doesn't match the Host used during signature generation

## Attempted Solutions (Failed)

### 1. URL Replacement with Host Header Preservation
- **Approach**: Replace internal URL with public URL, set nginx `Host` header to `minio:9000`
- **Result**: Still failed - signature includes full endpoint URL, not just host

### 2. MINIO_SERVER_URL Configuration
- **Approach**: Set `MINIO_SERVER_URL` environment variable in MinIO container
- **Result**: Failed - this only affects MinIO's console/browser redirects, not boto3's signature generation

### 3. Path-Style Addressing
- **Approach**: Configure boto3 to use path-style addressing (`s3={'addressing_style': 'path'}`)
- **Result**: Failed - didn't resolve signature validation issue

### 4. Different Regions
- **Approach**: Try empty region or different region names
- **Result**: Failed - region not the issue

### 5. Public Bucket Access
- **Approach**: Make bucket publicly readable to bypass signatures
- **Result**: Works but unacceptable - images should not be public

## Final Solution: Authenticated Streaming Endpoint

Instead of using presigned URLs, we implemented a secure API endpoint that streams images directly:

### Implementation

```python
@router.get("/{uuid}/thumbnail")
async def get_image_thumbnail(
    uuid: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """Stream image directly from MinIO with authentication."""
    # Fetch image metadata from database
    # Download image from MinIO using boto3
    # Stream to client with proper content-type
```

### Benefits

1. **Security**: All access requires JWT authentication
2. **Privacy**: Bucket remains private
3. **Simplicity**: No complex signature validation through proxy
4. **Reliability**: Direct boto3 access from API to MinIO (internal Docker network)
5. **Caching**: Can add cache headers for browser caching

### Trade-offs

1. **Performance**: Images flow through API server instead of direct S3 access
   - Acceptable for our use case (moderate traffic, small-medium images)
   - Can be optimized with caching layer if needed later

2. **Scalability**: API server becomes bottleneck for image serving
   - Not an issue at current scale
   - Can move to CDN/CloudFront if needed in future

## Architecture

### Before (Presigned URLs - Failed)
```
Browser → HTTPS → nginx → MinIO
          |                 |
          |                 ↓
          |            Signature validation fails
          ↓
    URL: https://dev.addaxai.com/minio/raw-images/...?X-Amz-Signature=...
```

### After (Streaming Endpoint - Working)
```
Browser → HTTPS → nginx → API → MinIO (internal)
          |                |       |
          |                |       ↓
          |                |   boto3 download
          |                ↓
          |           Stream image
          ↓
    URL: https://dev.addaxai.com/api/images/{uuid}/thumbnail
```

## Infrastructure Configuration

### docker-compose.yml
```yaml
minio:
  ports:
    - "127.0.0.1:9000:9000"  # Localhost only for nginx proxy
    - "127.0.0.1:9001:9001"  # Localhost only for console
```

### nginx (Ansible template)
```nginx
location /minio/ {
    proxy_pass http://localhost:9000/;
    proxy_set_header Host minio:9000;
    # ... other headers
}
```

### MinIO Bucket Policy
```bash
# Private by default
mc anonymous set private minio/raw-images
```

## Lessons Learned

1. **AWS S3 signatures are complex** - They include many request components (Host, path, query params) and are difficult to proxy transparently
2. **Presigned URLs work best for direct access** - They're not designed for proxy scenarios where headers/URLs are modified
3. **Streaming endpoints are simpler for internal storage** - When you control both the API and storage, streaming is more reliable than presigned URLs
4. **Consider the use case** - Presigned URLs are great for client-side uploads or temporary public access, but not necessary for authenticated image serving

## References

- [AWS S3 Signature Version 4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html)
- [MinIO Presigned URLs](https://min.io/docs/minio/linux/developers/python/API.html#presigned_get_object)
- [Boto3 Configuration](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/core/session.html#boto3.session.Session.client)

## Related Commits

- `573c01c` - Fix MinIO presigned URLs with proper Host header matching
- `8677e18` - Expose MinIO ports to localhost only for nginx proxy
- `fd1e77f` - Configure boto3 to use path-style addressing for MinIO
- `281f933` - Use public URLs instead of presigned URLs for MinIO (reverted)
- `1a2a879` - Add secure image streaming endpoint instead of presigned URLs (final solution)
