#!/bin/zsh
# Build the cross-device hero banner for the README and docs.
#
# Inputs are three screenshots from the demo project:
#   1. macOS window capture of the installed app on the dashboard
#      (Shift-Cmd-4, space, click the window; paint out the scrollbar)
#   2. iPhone screenshot of an image detail view with a bbox and label
#   3. iPad landscape screenshot of the fullscreen map with hexbins
#
# Usage: scripts/build-banner.sh <dashboard.png> <iphone.png> <ipad.png|jpg>
#
# Writes banner-light.png and banner-dark.png to the current directory.
# Convert to JPEG (~quality 88), upload both to a GitHub issue comment, and
# put the user-attachments URLs in README.md and docs/index.md.
set -e

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <dashboard.png> <iphone.png> <ipad.png|jpg>" >&2
  exit 1
fi
DASHBOARD=$1; IPHONE=$2; IPAD=$3

W=2800; H=1400
BEZEL="#1b1f20"
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# --- Device screens in minimal dark bezels ---

# iPad: screen 980 px wide (4:3), bezel 26, outer corner r 50
magick "$IPAD" -resize 980x \
  \( +clone -alpha extract -fill white -colorize 100 \
     -draw "roundrectangle 0,0 979,734 14,14" -blur 0x0.5 \) \
  -alpha off -compose CopyOpacity -composite $TMP/ipad-screen.png
magick -size 1032x787 xc:none -fill "$BEZEL" \
  -draw "roundrectangle 0,0 1031,786 50,50" $TMP/ipad-frame.png
magick $TMP/ipad-frame.png $TMP/ipad-screen.png -gravity center -composite $TMP/ipad-dev.png

# iPhone: screen 380 px wide (9:16), bezel 16, outer corner r 52
magick "$IPHONE" -resize 380x \
  \( +clone -alpha extract -fill white -colorize 100 \
     -draw "roundrectangle 0,0 379,675 12,12" -blur 0x0.5 \) \
  -alpha off -compose CopyOpacity -composite $TMP/iphone-screen.png
magick -size 412x708 xc:none -fill "$BEZEL" \
  -draw "roundrectangle 0,0 411,707 52,52" $TMP/iphone-frame.png
magick $TMP/iphone-frame.png $TMP/iphone-screen.png -gravity center -composite $TMP/iphone-dev.png

# Dashboard window keeps its own macOS chrome, only scaled
magick "$DASHBOARD" -resize 1750x $TMP/laptop-dev.png

# --- Soft drop shadows ---
for dev in ipad iphone; do
  magick $TMP/${dev}-dev.png \( +clone -background black -shadow 40x30+0+22 \) \
    +swap -background none -layers merge +repage $TMP/${dev}-sh.png
done
magick $TMP/laptop-dev.png \( +clone -background black -shadow 28x34+0+24 \) \
  +swap -background none -layers merge +repage $TMP/laptop-sh.png

# --- Assemble on a gradient, one light and one dark variant ---
build() {
  magick -size ${W}x${H} gradient:$1-$2 \
    $TMP/laptop-sh.png -geometry +100+90   -composite \
    $TMP/ipad-sh.png   -geometry +1620+450 -composite \
    $TMP/iphone-sh.png -geometry +1470+610 -composite \
    $3
  echo "built $3"
}
build "#f4f7f7" "#dfeaea" banner-light.png
build "#0e3538" "#06191b" banner-dark.png
