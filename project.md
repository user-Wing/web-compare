# Web Compare 项目地图

## 范围

0.3.1：最多九路 SDR 对比，多路布局/裁剪/对齐/视图控制，音轨与多核缩放/YUV 色度重建，HEVC/VVC WASM 软件兜底。不导出、不迁入原生依赖、不改 VS-Renderer-GUI、不写远端博客。

## 结构

- `src/media.js`：三容器解封装、能力检测、首帧与 PTS 索引、有限解码帧。
- `src/math.js`：PTS 查询、缩放锚点、最新请求队列。
- `src/layout.js`：二至九路布局、裁剪、分割线与换源。
- `src/kernels.js`：GLSL 插值/双边/亮度引导/Super-XBR 单阶段/抗振铃。
- `src/renderer.js`：WebGL2 整数 YUV 平面、矩阵/范围、色度重建、RGB 回退、缩放与像素读取。
- `src/audio.js`：所选音轨解码及 WebAudio 调度，共同播放时钟。
- `src/audio-worker.js`：音频独立读取及有限批次解码；文档侧保留原生兜底。
- `src/software-video.js` / `src/software-worker.js`：软件 HEVC/VVC、FFmpeg 容器/索引/关键帧跳转、原始 YUV 与精细 PTS。
- `src/worker-client.js`：Worker 请求和生命周期；沙箱使用 Blob Worker。
- `src/assets.js`：资源版本标识、无凭据读取与可定位的加载错误。
- `package/vendor/codecs*` / `scripts/build-codecs.sh`：自定义解码 WASM、许可、对应源码及固定版本重建。
- `src/runtime.js`：九源生命周期、共同提交、时间轴与交互。
- `package/`：博客 manifest/页面/样式/入口和 Super-XBR 许可。
- `scripts/`：独立构建与本机静态预览，不依赖原 GUI 路径。
- `tests/`：数学/布局/格式/范围、合成 YUV GPU 与真实浏览器媒体回归。

## 验证（2026-10-01）

0.3.1 增加 HEVC Rext I444P10/合成 3840×2160、博客实际 CSP、模拟旧 CDN 缓存和 WASM 断网回归。公网未带版本的 runtime.js 命中旧 Cloudflare 缓存（Age 5104 秒、max-age 14400），而远端磁盘已是 0.3.0。实际 VVC 1920×804 Main10 长片本机首帧、逐帧和 60 秒跳转通过（帧 1441/170097），公网绕过缓存首帧成功；远端用户 HEVC 已核对为 Rext/3840×2160/yuv444p10le，未播放该整部文件。

9 项单测通过；Chromium 145 与本机 Edge 完整回归通过。保留 MP4/MKV/MOV、全部 ABC/ABCD、九源、换源、逐源偏移、独立缩放、AAC 调度、主时钟和卸载，以及原两路/2160p/PTS/AB 像素/固定平移/全屏/沙箱回归。

新增强制关闭原生 HEVC 的 HEVC/VVC Main10 六种容器组合、精细 PTS/关键帧边界、双软件 A/B、静音/开音频吞吐对照、音频预启动不倒退、音量不重启及 opaque-origin Worker/WASM/音频回归。证据 `test-results/codec-results.json`，短素材吞吐不等于长片或真实设备性能保证。

合成 YUV 验证 BT.601/709 全/有限范围、十一色度核常量保持和边缘差异、九放大/六缩小核、RGBA 回退与 I420P10 中性色。桌面/九路和窄屏截图检查。证据位于 `test-results/`，不打包。

## 边界与交付

需要 WebCodecs/WebGL2；HEVC/VVC 可用随包软件兜底，其它编码仍取决于原生支持。SDR 原始平面路径独立色度生效，RGB 回退不生效；最终 RGBA8，没有 HDR/ICC 校准、madVR 专有代码/NGU、字幕、导出或 VRR。不保证与 3FP 逐像素一致；音频未经听感校验。软件首次索引比原生首帧路径慢，不保证多路 4K 实时。

Firefox 本机启动失败，Windows WebKit H.264 未通过；真实手机、长片、九路 4K 性能及所有平面格式未全面实测。

`dist/web-compare/` 为静态插件，`dist/web-compare.7z` 与 `.sha256` 为本机包/校验。预览 `http://localhost:4173/web-compare/`，用 `npm start` 重开。普通沙箱未放宽；iframe 全屏需宿主授权，独立页面可用。未部署网页或发布 Release，源码更新至 GitHub。

当前 0.3.1 包 `dist/web-compare-0.3.1.7z`（另有固定名称 `web-compare.7z`）包含 WASM、完整许可及对应源码归档，大小 18,236,246 字节，7z 完整性测试通过。SHA-256：`61FDA97062F539C751DDF0111D0F34498B570D494FB7CCDE0F0554BD42BA38E7`；各包附 `.sha256`，旧包校验不再适用。0.3.1 的 Chromium/Edge 新增编码回归、原有完整浏览器回归及 9 项单测通过。

独立缩放回归还验证倍率文字不导致工具栏换行/画布尺寸改变；固定倍率栏宽度，避免其它 Fit 窗格意外跟着重适配。

## GitHub 开源

源码仓库：`https://github.com/user-Wing/web-compare`，公开仓库，自有代码 MIT，版本 0.3.1。上传源码、锁定依赖清单、测试、说明及解码 WASM/对应源码（第三方 LGPL/ISC 等独立许可）；排除 node_modules、dist、本机压缩包和测试素材。FFmpeg 测试入口使用 PATH 或环境变量，不依赖开发机路径。没有创建 Release 或部署网页。
