import { kernelShader } from './kernels.js';

const vertex = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uY,uU,uV;
uniform sampler2D uRGB;
uniform float uMaximum;
uniform bool uInterleaved,uRaw,uConvert,uAnti;
uniform int uAlgorithm;
uniform vec2 uCanvas;
uniform vec4 uRect,uRange;
uniform vec2 uCoefficients,uChromaShift;
out vec4 outputColor;
ivec2 dimensions(int plane){
  if(plane==3)return textureSize(uRGB,0);
  if(plane==0)return textureSize(uY,0);
  if(plane==1||uInterleaved)return textureSize(uU,0);
  return textureSize(uV,0);
}
vec3 fetchValue(ivec2 p,int plane){
  p=clamp(p,ivec2(0),dimensions(plane)-1);
  if(plane==3)return texelFetch(uRGB,p,0).rgb;
  float v;
  if(plane==0)v=float(texelFetch(uY,p,0).r);
  else if(plane==1)v=float(texelFetch(uU,p,0).r);
  else if(uInterleaved)v=float(texelFetch(uU,p,0).g);
  else v=float(texelFetch(uV,p,0).r);
  return vec3(v/uMaximum);
}
${kernelShader.replace('vec3 fetchValue(ivec2 p, int plane);', '').replace('ivec2 dimensions(int plane);', '')}
void main(){
  vec2 uv;
  if(uConvert)uv=gl_FragCoord.xy/uCanvas;
  else uv=(vec2(gl_FragCoord.x,uCanvas.y-gl_FragCoord.y)-uRect.xy)/uRect.zw;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThanEqual(uv,vec2(1.))))discard;
  vec3 rgb;
  if(uConvert&&uRaw){
    float y=(fetchValue(ivec2(uv*vec2(dimensions(0))),0).r-uRange.x)*uRange.y;
    vec2 cuv=uv+uChromaShift;
    vec2 c=(vec2(reconstruct(cuv,1,uAlgorithm,vec2(1.),uAnti).r,reconstruct(cuv,2,uAlgorithm,vec2(1.),uAnti).r)-uRange.z)*uRange.w;
    float kr=uCoefficients.x,kb=uCoefficients.y,kg=1.-kr-kb;
    rgb=vec3(y+(2.-2.*kr)*c.y,y-kb*(2.-2.*kb)/kg*c.x-kr*(2.-2.*kr)/kg*c.y,y+(2.-2.*kb)*c.x);
  }else if(uConvert)rgb=fetchValue(ivec2(uv*vec2(dimensions(3))),3);
  else rgb=reconstruct(uv,3,uAlgorithm,vec2(dimensions(3))/uRect.zw,uAnti);
  outputColor=vec4(clamp(rgb,0.,1.),1.);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log);
  }
  return shader;
}

export function planeFormat(format, width, height) {
  if (format === 'NV12') return { bits: 8, interleaved: true, sizes: [[width, height, 1], [Math.ceil(width / 2), Math.ceil(height / 2), 2]] };
  const match = /^I(420|422|444)(?:P(10|12))?$/.exec(format || '');
  if (!match) return null;
  const cw = Math.ceil(width / (match[1] === '444' ? 1 : 2)), ch = Math.ceil(height / (match[1] === '420' ? 2 : 1));
  return { bits: Number(match[2] || 8), interleaved: false, sizes: [[width, height, 1], [cw, ch, 1], [cw, ch, 1]] };
}

export function colorParameters(space, bits, height) {
  const maximum = 2 ** bits - 1, scale = 2 ** (bits - 8);
  const matrix = space?.matrix || (height > 576 ? 'bt709' : 'smpte170m');
  const coefficients = matrix === 'bt709' ? [.2126, .0722] : matrix === 'bt2020-ncl' ? [.2627, .0593] : [.299, .114];
  const range = space?.fullRange === true ? [0, 1, 2 ** (bits - 1) / maximum, 1] : [16 * scale / maximum, maximum / (219 * scale), 128 * scale / maximum, maximum / (224 * scale)];
  return { matrix, maximum, coefficients, range, assumed: !space?.matrix || space?.fullRange == null };
}

export class GpuRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('当前环境不支持 WebGL2；多算法渲染需要启用浏览器硬件加速。');
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, vertex), fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram(); gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.uniforms = {};
    for (const name of ['uY', 'uU', 'uV', 'uRGB', 'uMaximum', 'uInterleaved', 'uRaw', 'uConvert', 'uAnti', 'uAlgorithm', 'uCanvas', 'uRect', 'uRange', 'uCoefficients', 'uChromaShift']) this.uniforms[name] = gl.getUniformLocation(this.program, name);
    this.cache = Array(9).fill(null); this.spares = Array(9).fill(null);
    this.placeholder = this.texture(1, 1, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    this.placeholderRGB = this.texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.scratch = document.createElement('canvas');
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  texture(width, height, internal, format, type, data, reuse = null) {
    const gl = this.gl, texture = reuse || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
    return texture;
  }
  release(bundle) {
    if (!bundle) return;
    const gl = this.gl;
    for (const texture of [...bundle.planes, bundle.rgb, bundle.output]) if (texture) gl.deleteTexture(texture);
    gl.deleteFramebuffer(bundle.fbo);
  }
  bind(bundle) {
    const gl = this.gl, u = this.uniforms;
    gl.useProgram(this.program);
    const textures = [bundle.planes[0] || this.placeholder, bundle.planes[1] || this.placeholder, bundle.planes[2] || this.placeholder, bundle.rgb || this.placeholderRGB];
    textures.forEach((texture, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture); });
    ['uY', 'uU', 'uV', 'uRGB'].forEach((name, i) => gl.uniform1i(u[name], i));
    gl.uniform1f(u.uMaximum, bundle.color?.maximum || 255);
    gl.uniform1i(u.uInterleaved, bundle.interleaved ? 1 : 0); gl.uniform1i(u.uRaw, bundle.raw ? 1 : 0);
    gl.uniform4fv(u.uRange, bundle.color?.range || [0, 1, .5, 1]); gl.uniform2fv(u.uCoefficients, bundle.color?.coefficients || [.2126, .0722]);
  }
  async upload(sample, settings, reuse) {
    const gl = this.gl;
    const bundle = reuse || { planes: [], rgb: null, output: null, fbo: gl.createFramebuffer() };
    const frame = sample.toVideoFrame();
    try {
      const rect = frame.visibleRect, space = frame.colorSpace;
      const format = planeFormat(frame.format, rect.width, rect.height);
      const hdr = ['smpte2084', 'arib-std-b67'].includes(space?.transfer);
      const wide = !!space?.primaries && !['bt709', 'bt470bg', 'smpte170m'].includes(space.primaries);
      const matrixSupported = !space?.matrix || ['bt709', 'bt470bg', 'smpte170m', 'bt2020-ncl'].includes(space.matrix);
      bundle.copyFailure = '';
      bundle.raw = !!format && matrixSupported && !hdr && !wide && !sample.rotation && !sample.flip;
      bundle.width = bundle.raw ? rect.width : sample.displayWidth;
      bundle.height = bundle.raw ? rect.height : sample.displayHeight;
      if (Math.max(bundle.width, bundle.height) > this.maxTextureSize) throw new Error(`视频超过设备纹理上限 ${this.maxTextureSize}。`);
      if (bundle.raw) {
        try {
        // copyTo preserves the decoded Y/U/V values, instead of uploading already reconstructed RGB.
        const buffer = new Uint8Array(frame.allocationSize());
        const layouts = await frame.copyTo(buffer);
        const bytes = format.bits > 8 ? 2 : 1;
        format.sizes.forEach(([w, h, channels], i) => {
          const layout = layouts[i];
          gl.activeTexture(gl.TEXTURE0);
          gl.pixelStorei(gl.UNPACK_ROW_LENGTH, layout.stride / (bytes * channels));
          const data = bytes === 1 ? buffer.subarray(layout.offset) : new Uint16Array(buffer.buffer, layout.offset, Math.floor((buffer.byteLength - layout.offset) / 2));
          bundle.planes[i] = this.texture(w, h, bytes === 1 ? channels === 1 ? gl.R8UI : gl.RG8UI : gl.R16UI, channels === 1 ? gl.RED_INTEGER : gl.RG_INTEGER, bytes === 1 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, data, bundle.planes[i]);
        });
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        bundle.interleaved = format.interleaved;
        bundle.color = colorParameters(space, format.bits, rect.height);
        bundle.description = `${frame.format} 原始色度 · ${bundle.color.matrix} · ${space.fullRange ? '全范围' : '有限范围'}${bundle.color.assumed ? '（部分元数据推定）' : ''}`;
        } catch (error) {
          bundle.raw = false;
          bundle.copyFailure = error.message;
          gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        }
      }
      if (!bundle.raw) {
        const scratch = this.scratch; scratch.width = bundle.width; scratch.height = bundle.height;
        sample.draw(scratch.getContext('2d'), 0, 0, bundle.width, bundle.height);
        gl.activeTexture(gl.TEXTURE0); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        bundle.rgb ||= gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, bundle.rgb);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
        bundle.description = `浏览器 RGB 回退（${hdr || wide ? 'HDR/广色域由浏览器转换' : bundle.copyFailure ? '平面读取不可用' : frame.format || '不可读取 YUV 平面'}；色度核不生效）`;
      }
      gl.activeTexture(gl.TEXTURE0);
      bundle.output = this.texture(bundle.width, bundle.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, bundle.output);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bundle.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bundle.output, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU 颜色重建帧缓冲不可用。');
      this.bind(bundle); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, bundle.width, bundle.height);
      const u = this.uniforms;
      gl.uniform1i(u.uConvert, 1); gl.uniform1i(u.uAlgorithm, settings.chroma); gl.uniform1i(u.uAnti, settings.anti ? 1 : 0);
      gl.uniform2f(u.uCanvas, bundle.width, bundle.height);
      gl.uniform2f(u.uChromaShift, settings.siting === 'left' && bundle.raw ? .5 / bundle.width : 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`WebGL 帧上传失败 (${error})。`);
      bundle.sample = sample; bundle.key = `${settings.chroma}/${settings.anti}/${settings.siting}`;
      return bundle;
    } catch (error) { this.release(bundle); throw error; }
    finally { frame.close(); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); }
  }
  async prepare(samples, settings, current = () => true) {
    const key = `${settings.chroma}/${settings.anti}/${settings.siting}`, pending = [];
    try {
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        if (sample && (this.cache[i]?.sample !== sample || this.cache[i]?.key !== key)) {
          const reuse = this.spares[i]; this.spares[i] = null;
          pending.push([i, await this.upload(sample, settings, reuse)]);
        }
        if (!current()) break;
      }
      if (!current()) { pending.forEach(([i, bundle]) => { this.spares[i] = bundle; }); return false; }
      for (const [i, bundle] of pending) { this.spares[i] = this.cache[i]; this.cache[i] = bundle; }
      samples.forEach((sample, i) => { if (!sample) { this.release(this.cache[i]); this.release(this.spares[i]); this.cache[i] = this.spares[i] = null; } });
      return true;
    } catch (error) { pending.forEach(([, bundle]) => this.release(bundle)); throw error; }
  }
  draw(items, settings, width, height, dpr) {
    const gl = this.gl, u = this.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST); gl.clearColor(.031, .043, .063, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    for (const { source, clip, rect } of items) {
      const bundle = this.cache[source]; if (!bundle) continue;
      this.bind({ ...bundle, rgb: bundle.output });
      gl.enable(gl.SCISSOR_TEST);
      const x = Math.round(clip.x * dpr), right = Math.round((clip.x + clip.w) * dpr);
      const top = Math.round(clip.y * dpr), bottom = Math.round((clip.y + clip.h) * dpr);
      gl.scissor(x, this.canvas.height - bottom, right - x, bottom - top);
      gl.uniform1i(u.uConvert, 0); gl.uniform1i(u.uAnti, settings.anti ? 1 : 0);
      const effectiveScale = Math.min(rect.w / bundle.width, rect.h / bundle.height) * dpr;
      gl.uniform1i(u.uAlgorithm, effectiveScale < 1 ? settings.downscale : settings.upscale);
      gl.uniform2f(u.uCanvas, width * dpr, height * dpr);
      gl.uniform4f(u.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
  }
  readPixel(x, y) {
    const pixel = new Uint8Array(4), gl = this.gl;
    gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel].slice(0, 3);
  }
  destroy() {
    [...this.cache, ...this.spares].forEach(bundle => this.release(bundle));
    this.gl.deleteTexture(this.placeholder); this.gl.deleteTexture(this.placeholderRGB); this.gl.deleteProgram(this.program);
  }
}
