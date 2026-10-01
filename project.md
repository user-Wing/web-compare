# Web Compare 项目地图

## 范围

0.2.0：最多九路 SDR 对比、多路布局/裁剪/对齐/视图控制、音轨选择、多核缩放及真实 YUV 色度重建。不导出、不迁入原生依赖、不改 VS-Renderer-GUI、不写远端博客。

## 结构

- `src/media.js`：三容器解封装、能力检测、首帧与 PTS 索引、有限解码帧。
- `src/math.js`：PTS 查询、缩放锚点、最新请求队列。
- `src/layout.js`：二至九路布局、裁剪、分割线与换源。
- `src/kernels.js`：GLSL 插值/双边/亮度引导/Super-XBR 单阶段/抗振铃。
- `src/renderer.js`：WebGL2 整数 YUV 平面、矩阵/范围、色度重建、RGB 回退、缩放与像素读取。
- `src/audio.js`：所选音轨解码及 WebAudio 调度，共同播放时钟。
- `src/runtime.js`：九源生命周期、共同提交、时间轴与交互。
- `package/`：博客 manifest/页面/样式/入口和 Super-XBR 许可。
- `scripts/`：独立构建与本机静态预览，不依赖原 GUI 路径。
- `tests/`：数学/布局/格式/范围、合成 YUV GPU 与真实浏览器媒体回归。

## 验证（2026-10-01）

8 项单测通过；Chromium 145 与本机 Edge 完整回归通过。覆盖 MP4/MKV/MOV、全部 ABC/ABCD、九源、换源、逐源偏移、独立缩放、AAC 调度、主时钟和卸载，以及原两路/2160p/PTS/AB 像素/固定平移/全屏/沙箱回归。

合成 YUV 验证 BT.601/709 全/有限范围、十一色度核常量保持和边缘差异、九放大/六缩小核、RGBA 回退与 I420P10 中性色。桌面/九路和窄屏截图检查。证据位于 `test-results/`，不打包。

## 边界与交付

需要 WebCodecs/WebGL2 及对应编码能力。SDR 原始平面路径独立色度生效，RGB 回退不生效；最终 RGBA8，没有 HDR/ICC 校准、madVR 专有代码/NGU、字幕、导出或 VRR。不保证与 3FP 逐像素一致；音频未经听感校验。

Firefox 本机启动失败，Windows WebKit H.264 未通过；真实手机、长片、九路 4K 性能及所有平面格式未全面实测。

`dist/web-compare/` 为静态插件，`dist/web-compare.7z` 与 `.sha256` 为本机包/校验。预览 `http://localhost:4173/web-compare/`，用 `npm start` 重开。普通沙箱未放宽；iframe 全屏需宿主授权，独立页面可用。没有部署上传。

0.2.0 归档：LZMA2 极限压缩，416946 字节、76 文件；`7z t` 通过。SHA-256：`CB479A6C1EC20E665012283DD9E63BDC4E7F6517274E2E153A05D707552689AF`。

独立缩放回归还验证倍率文字不导致工具栏换行/画布尺寸改变；固定倍率栏宽度，避免其它 Fit 窗格意外跟着重适配。

## GitHub 开源

源码仓库：`https://github.com/user-Wing/web-compare`，公开仓库，自有代码 MIT，版本保持 0.2.0。上传源码、锁定依赖清单、测试和说明；排除依赖目录、构建产物、本机压缩包和测试素材。FFmpeg 测试入口使用 PATH 或环境变量，不依赖开发机路径。没有创建 Release 或部署网页。
