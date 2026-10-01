#!/usr/bin/env bash
set -euo pipefail
# Requires Emscripten 4.0.23, Node.js, make, git, curl and xz in PATH.
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="${CODECS_BUILD_DIR:-/tmp/web-compare-codecs/libav.js}"
if [ ! -d "$build_dir/.git" ]; then
  git clone https://github.com/Yahweasel/libav.js.git "$build_dir"
fi
cd "$build_dir"
git checkout c80e885c3461f7bb7ea565c9631b34243ae0dbf1
npm ci --ignore-scripts
cd configs
node mkconfig.js web-compare '["avformat","avcodec","avframe","demuxer-mp4","demuxer-matroska","parser-hevc","decoder-hevc","parser-vvc","decoder-vvc"]'
cd ..
make -j4 OPTFLAGS=-O3 dist/libav-6.10.9.0-web-compare.js dist/libav-6.10.9.0-web-compare.wasm.js
mkdir -p "$project_dir/package/vendor/codecs"
cp dist/libav-6.10.9.0-web-compare.js dist/libav-6.10.9.0-web-compare.wasm.js dist/libav-6.10.9.0-web-compare.wasm.wasm "$project_dir/package/vendor/codecs/"
cp build/ffmpeg-9.0/COPYING.LGPLv2.1 "$project_dir/package/vendor/codecs/"
cp "$(dirname "$(command -v emcc)")/LICENSE" "$project_dir/package/vendor/codecs/Emscripten-LICENSE.txt"
mkdir -p "$project_dir/package/vendor/codecs-source"
git archive --format=tar.gz HEAD -o "$project_dir/package/vendor/codecs-source/libav.js-c80e885.tar.gz"
cp build/ffmpeg-9.0.tar.xz "$project_dir/package/vendor/codecs-source/"
cp build/emfiberthreads/emfiberthreads-1.3.tar.gz "$project_dir/package/vendor/codecs-source/" 2>/dev/null || cp build/emfiberthreads-1.3.tar.gz "$project_dir/package/vendor/codecs-source/"
