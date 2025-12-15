# Authentication Background Image

Place your background image here as `auth-background.jpg`

## Recommended Specifications

- **Format**: JPEG or WebP
- **Dimensions**: 1920x1080 or higher (Full HD recommended)
- **Aspect Ratio**: 16:9
- **File Size**: < 500KB (optimize for web)
- **Subject**: Wildlife/nature photography that represents camera trap imagery

## Optimization Tips

### Using ImageMagick (command line):
```bash
# Resize and optimize JPEG
convert your-image.jpg -resize 1920x1080^ -gravity center -extent 1920x1080 -quality 85 auth-background.jpg

magick "/Users/peter/Downloads/background-img/original1.jpg" \
  -resize 2560x \
  -gaussian-blur 0x2 \  
  -quality 65 \
  -define webp:target-size=102400 \
  "/Users/peter/Downloads/background-img/background.webp"

# Convert to WebP (smaller file size)
convert your-image.jpg -resize 1920x1080^ -gravity center -extent 1920x1080 -quality 85 auth-background.webp

magick "/Users/peter/Downloads/background-img/original1.jpg" \
  -resize 2560x \
  -gaussian-blur 0x2 \
  -quality 60 \
  -interlace Plane \
  -strip \
  "/Users/peter/Downloads/background-img/background.jpg"

```

### Using online tools:
- **TinyJPG/TinyPNG**: https://tinyjpg.com (compress without quality loss)
- **Squoosh**: https://squoosh.app (Google's image optimizer)

## Fallback

If no image is provided, the page will show:
- A solid gray background (`bg-gray-50`)
- Content is still fully functional

## Example Wildlife Images

Consider using:
- Camera trap images from your projects
- Wildlife photography (with proper licensing)
- Nature landscapes
- Free stock photos from:
  - Unsplash: https://unsplash.com/s/photos/wildlife
  - Pexels: https://www.pexels.com/search/wildlife/
  - Pixabay: https://pixabay.com/images/search/wildlife/
