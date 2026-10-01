# HEVC / VVC 软件解码模块

此目录为 FFmpeg 9.0 的解码专用 WASM 构建，不是 FFmpeg 命令行，也不包含编码器或联网协议。

- libav.js 6.10.9.0，固定 commit `c80e885c3461f7bb7ea565c9631b34243ae0dbf1`：https://github.com/Yahweasel/libav.js
- FFmpeg 9.0：https://ffmpeg.org/releases/ffmpeg-9.0.tar.xz
- Emscripten 4.0.23：构建工具；MIT/UIUC 声明见 `Emscripten-LICENSE.txt`。
- emfiberthreads 1.3：libav.js 使用的单线程兼容层；源码及其许可在 `../codecs-source/emfiberthreads-1.3.tar.gz`。
- FFmpeg LGPL-2.1-or-later，完整许可 `COPYING.LGPLv2.1`；libav.js 包装代码保留文件头的 ISC 声明。

只启用 HEVC/VVC 解码、解析器及 MOV（含 MP4）/Matroska 容器解封装。没有 GPL 编码器或 FFmpeg 可执行程序；使用单线程兼容层，不是依赖 SAB 的多线程 WASM，不要求 COOP/COEP。

对应源码随包保留在 `../codecs-source/`：libav.js Git 快照（包含 FFmpeg 补丁和 emfiberthreads 构建规则）、FFmpeg 原始源码归档及 emfiberthreads 源码。项目仓库包含同一份源码归档与 `scripts/build-codecs.sh`，可以修改或重新链接替换整个模块；没有增加禁止逆向调试第三方模块的限制。

重建需要 Linux/WSL、Emscripten 4.0.23、Node.js、make、git、curl、xz，先激活 Emscripten 环境，然后运行仓库的 `bash scripts/build-codecs.sh`，最后 `npm run build`。仅重建 WASM 时需要这些工具；普通源码构建直接使用随仓库的 WASM，只需 Node/npm。

部署需保留此目录所有文件，WASM MIME 为 `application/wasm`。软件后端使用 Blob Worker；宿主 CSP 若有限制，需允许本工具所用的 Worker 和 WASM 执行。普通 opaque-origin iframe 还需要静态 JS/WASM 资源允许 CORS（如无凭据的 `Access-Control-Allow-Origin: *`）；这不是对账号/API 开放 CORS。
