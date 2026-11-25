#!/usr/bin/env bash
# 把网页版静态资源复制到 www/（Capacitor 的 webDir）。不含 sw.js、不含任何照片。
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www
cp -r index.html css js data icons manifest.webmanifest national-2027.ics www/
