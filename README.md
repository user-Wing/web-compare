# Web Compare

纯浏览器多路视频对比工具。打开部署后的网页选择本地视频，无需安装 3FP、VS、FFmpeg 或本地服务；文件不上传。

源码仓库：[user-Wing/web-compare](https://github.com/user-Wing/web-compare)。项目自有代码采用 [MIT License](LICENSE)，第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 功能（0.3.0）

- 最多九路 MP4/MKV/MOV，单独选择、批量拖入、交换窗格和移除。
- 两路并排/AB；三路并排、横三段、纵三段、左一右二、右一左二；四路网格/ABCD；五至九路网格。
- 同步/独立缩放、滚轮锚点放大、固定屏幕像素平移、触摸平移/双指缩放、适应窗口、100% 与全屏。
- 共同时间轴、实际 PTS/帧号、主时钟选择、逐帧、逐源 ±帧/±秒/时间偏移。
- 各可见路完成解码/GPU 上传后一起呈现；性能不足时追赶共同播放时钟，不积压旧请求。
- 选择某一路音轨、音量与静音；鼠标显示最终画面的 RGB 像素读数。
- 九种放大核：Nearest、Bilinear、Catmull-Rom、Lanczos3、Jinc2、Spline36、Super-XBR 单阶段、Softcubic、Mitchell-Netravali。
- 六种缩小核：Nearest、Bilinear、Catmull-Rom、Lanczos3、Jinc2、Spline36。
- 十一种独立色度核：九种放大核加 Bilateral、亮度引导双边；抗振铃及中心/左侧色度位置。

不含导出、字幕、VS 滤镜、VRR 或 HDR 校准。

HEVC 原生解码不可用（或首帧解码失败）时自动使用随包 WASM；VVC 使用 WASM 解封装/软件解码。无需安装系统编码扩展或上传转码。

## 使用与对齐

滚轮放大、拖动平移、双击适应窗口；左右方向键逐帧，空格播放/暂停。分割线可拖动，聚焦后可用方向键调整。源面板可收起，更多源在面板内滚动。

偏移正值显示该源更晚的位置。视频开始时间归一为 0；不同帧率按共同时间选择正在呈现的帧，不要求帧号相等。越界保持首/末帧；逐帧以选定主时钟的 PTS 为准。

100% 是一个参考源像素占一个 CSS 像素，画布考虑设备像素比。同步视图把其它源等比匹配参考画布，共用缩放/平移；取消同步可分别检查。AB/ABC/ABCD 强制同步，裁剪共同画布，不把视频拉伸成分割区域形状。

## 颜色实现与限制

原 GUI 的这组“颜色处理”主要是色度重建，不是完整的 madVR 色彩管理，不含 madVR 专有代码或 NGU。

可读取的 SDR YUV 帧上传真实整数 Y/U/V 平面，按所选核重建色度，再按 BT.601/709 矩阵和全/有限范围转 RGB，最后独立缩放。格式支持 I420/I422/I444 的 8/10/12-bit 与 8-bit NV12，实际取决于解码器。缺失矩阵按 SD/HD 推定，缺失范围按有限范围处理，界面会标记推定信息。

色度位置缺少可靠帧级元数据，默认中心，可手动选左侧，不是自动识别。锐核可能振铃，抗振铃抑制过冲；双边核可保边但可能局部平滑；Nearest 便于直接观察差异。

平面不可读、旋转/翻转、HDR 或广色域等情况使用浏览器 RGB 转换并明确标示回退，独立色度设置此时不能作用于已转换的 RGB。最终中间纹理/显示读数是 8-bit SDR，不是高位深 HDR、ICC 校准或与 3FP 逐像素一致的保证。

实现依据：[WebCodecs](https://www.w3.org/TR/webcodecs/)、[WebGL2](https://registry.khronos.org/webgl/specs/latest/2.0/)。算法来源与许可见 `THIRD_PARTY_NOTICES.md`。

## 格式与设备

普通路径由 Mediabunny 解析 MP4/MKV/MOV，WebCodecs 解码；不依赖 `<video>` 原生读取 MKV。HEVC/VVC 的软件兜底使用 Worker 中的 FFmpeg/libav.js WASM，按需读取本地 Blob，不把完整视频复制进 WASM 内存。保留原始 YUV、PTS、逐帧和多路对比。

软件解码是 CPU 工作，不等于硬件解码，弱设备和多路 4K 仍可能掉帧；当前回归覆盖 Main10，不能据此保证所有扩展 profile。其他视频/音频编码仍取决于 WebCodecs 支持。

音频使用独立文件读取与 Worker 解码、有限预缓冲和共用增益，平滑播放时钟不会因音频启动延迟倒退；改音量不重建链。某些 opaque-origin Worker 不提供 AudioDecoder，会退回文档中的原生音频解码，但仍独立读取、有限缓冲。

需要 HTTPS（开发可用 localhost）、WebCodecs 和 WebGL2。访客无需 Node.js，静态站点无需视频服务器、跨源隔离或 CDN。

首帧先显示，再扫描包时间戳建立索引，只保留时间戳及有限解码帧。大文件首次索引仍可能等待；不承诺九路 4K 实时。

软件路径目前先在 Worker 中扫描 PTS，再显示首帧，大文件导入可能比原生路径慢。部署需保留 `vendor/codecs/`，允许 Blob Worker/WASM；opaque-origin iframe 所用静态 JS/WASM 需提供无凭据 CORS。无需 SharedArrayBuffer 或 COOP/COEP，不要为此放宽账号/API 的跨域策略。

Windows Chromium 145 和本机 Edge 已通过自动回归：三容器、H.264 B 帧、双路 2160p 跳转、PTS/偏移/逐帧、全部多路布局、九源、独立缩放、AAC 调度、AB 像素、窗口/全屏、窄屏及 opaque-origin iframe。合成 YUV 验证矩阵/范围、十一色度核、缩放核与 10-bit 中性色。音频未做人工听感校验。

0.3.0 另有 HEVC/VVC Main10 的六种编码/容器组合测试（强制禁用原生 HEVC），覆盖前/后逐帧、跳转、双软件 A/B、音频预启动不倒退、静音/开音频显示吞吐对照、音量不重启和 opaque-origin Worker/WASM/音频。吞吐是短素材回归，不代表真实设备性能上限。

Firefox 本机启动失败，Windows WebKit H.264 测试未通过；真实 Safari/iOS/Android、长片、所有位深/格式与性能上限未全面验证。

## 开发与插件

开发需要 Node.js 22+ 与 npm。安装依赖并构建：

```powershell
npm ci
npm run build
npm start
```

打开 `http://localhost:4173/web-compare/`。

```powershell
npm test
npx playwright install chromium
# 默认也测试本机 Edge；只测 Chromium：
$env:BROWSER_CHANNELS='chromium'
$env:FFMPEG='C:\path\to\ffmpeg.exe'
npm run test:browser
# HEVC/VVC 软件路径与开音频回归（FFmpeg 需含 libx265/libvvenc）：
npm run test:codecs
```

FFmpeg 只用于生成浏览器测试素材，不是网页运行依赖；可放入 PATH 或通过 `FFMPEG` 指定。Playwright 浏览器也仅用于测试。源码仓库不提交 `node_modules/`、`dist/`、测试生成的视频/截图或本机压缩包，克隆后按上述命令构建即可。

此处指本机 FFmpeg 可执行程序；网页自带的解码 WASM 是运行资源，已随源码/构建包保留。其对应源码和重建说明见 `package/vendor/codecs/BUILD.md`，普通 `npm run build` 不需要安装 Emscripten。

证据在 `test-results/`，不打包。`dist/web-compare/` 是完整博客工具包，含 manifest、页面、样式、runtime、许可和 Mediabunny 对应源码，运行无 CDN。

将完整目录或 `web-compare.7z` 放入博客 `tools/`，按现有机制发现。已只读核对远端约定并验证普通 opaque-origin 沙箱，不放宽 allow-same-origin。博客 iframe 未授权全屏时需独立打开，按钮会提示。

源码公开于 GitHub；本机插件包未作为 Release 发布，未部署网页，未改 VS-Renderer-GUI。
