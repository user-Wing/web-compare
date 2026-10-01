# 第三方组件

项目自有代码采用 MIT License（见根目录 `LICENSE`）。以下组件遵循各自许可，不由本项目 MIT 许可取代。

- Mediabunny 1.61.0：视频容器解封装、帧解码和时间戳查询。
  项目：https://github.com/Vanilagy/mediabunny
  许可证：MPL-2.0。未修改其源码。
  工具包内 `vendor/mediabunny-LICENSE.txt` 保存完整许可证，
  `vendor/mediabunny-source/` 保存此版本的对应源文件。
- esbuild 0.25.12（MIT）和 Playwright 1.58.2（Apache-2.0）仅用于开发与测试，不随工具包运行。
- Super-XBR 单阶段对角核：Copyright (c) 2015 Hyllian，MIT。
  从 [MPDN Extensions pass-0 shader](https://github.com/zachsaw/MPDN_Extensions/blob/master/Extensions/RenderScripts/Super-xBR/super-xbr.hlsl) 适配到 GLSL ES；不是完整三阶段算法。
  完整许可保留在 `vendor/Super-XBR-LICENSE.txt`，实现位于 `src/kernels.js`。
- 算法选择和行为参考原 GUI 与 [FFF Project / 3FP](https://github.com/Lake1059/FFF_Project) 的公开实现；未携带其原生运行时。

不包含 madVR 专有代码或 NGU 算法；相同核名称不意味着输出逐像素相同。

工具包不含 FFmpeg、3FP、VapourSynth、本地解码服务或转码程序。
