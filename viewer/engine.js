// Minimal custom WebGL2 block overlay with weighted-blended order-independent
// transparency. It deliberately owns only the translucent world pass and the
// opaque depth prepass; the existing renderer keeps sky/UI/entities until the
// remaining block passes are migrated.
const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUv;
layout(location=2) in vec3 aNormal;
uniform mat4 uProjection;
uniform mat4 uView;
out vec2 vUv;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = vec4(aPosition, 1.0);
  vWorld = aPosition;
  vUv = aUv;
  vNormal = aNormal;
  gl_Position = uProjection * uView * world;
}`;

const DEPTH_FRAG = `#version 300 es
precision highp float;
void main() {}`;

const OIT_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUv;
layout(location=2) in vec3 aNormal;
uniform mat4 uProjection;
uniform mat4 uView;
out vec2 vUv;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vUv = aUv;
  vNormal = aNormal;
  vWorld = aPosition;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}`;

const OIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in vec3 vWorld;
uniform sampler2D uTexture;
uniform vec4 uTint;
uniform float uOpacity;
uniform vec3 uCamera;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
layout(location=0) out vec4 outAccum;
layout(location=1) out vec4 outReveal;
void main() {
  vec4 tex = texture(uTexture, vUv);
  float alpha = tex.a * uOpacity * uTint.a;
  if (alpha < 0.004) discard;
  vec3 n = normalize(vNormal);
  float light = 0.72 + 0.28 * max(dot(n, normalize(vec3(-0.4, 0.8, 0.45))), 0.0);
  vec3 color = tex.rgb * uTint.rgb * light;
  float dist = distance(vWorld, uCamera);
  float fog = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);
  color = mix(color, uFogColor, fog);
  // McGuire/Bavoil weighted blended OIT accumulation.
  float w = clamp(0.03 / (1e-5 + pow(dist / 180.0, 4.0)), 1e-2, 3e3);
  outAccum = vec4(color * alpha * w, alpha * w);
  outReveal = vec4(alpha, alpha, alpha, alpha);
}`;

const COMPOSITE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAccum;
uniform sampler2D uReveal;
out vec4 outColor;
void main() {
  vec4 accum = texture(uAccum, vUv);
  float reveal = texture(uReveal, vUv).r;
  vec3 color = accum.rgb / max(accum.a, 0.0001);
  float alpha = clamp(1.0 - reveal, 0.0, 1.0);
  outColor = vec4(color, alpha);
}`;

export class BlockOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable for custom block renderer');
    this.gl = gl;
    this.lastError = 0;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.programs = {
      depth: this.program(VERT, DEPTH_FRAG),
      oit: this.program(OIT_VERT, OIT_FRAG),
      composite: this.program(COMPOSITE_VERT, COMPOSITE_FRAG),
    };
    this.quad = this.quadBuffer();
    this.textures = new Map();
    this.loadingTextures = new Set();
    this.fallback = this.makeFallback();
    this.batches = { opaque: [], transparent: [] };
    this.width = 0;
    this.height = 0;
    this.fbo = null;
    this.initFramebuffer();
  }

  program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
      }
      return sh;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
    }
    const uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, uniforms };
  }

  quadBuffer() {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    return b;
  }

  initFramebuffer() {
    const gl = this.gl;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo.fbo);
      gl.deleteTexture(this.fbo.accum);
      gl.deleteTexture(this.fbo.reveal);
      gl.deleteRenderbuffer(this.fbo.depth);
    }
    const w = this.width, h = this.height;
    if (!w || !h) return;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const accum = this.target(gl.RGBA16F, gl.RGBA, this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, w, h);
    const reveal = this.target(gl.R16F, gl.RED, this.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, w, h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accum, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, reveal, 0);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbo = { fbo, accum, reveal, depth, status: gl.checkFramebufferStatus(gl.FRAMEBUFFER) };
  }

  target(internal, format, type, w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    return tex;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.initFramebuffer();
  }

  setWorld(batches) {
    const gl = this.gl;
    for (const list of [this.batches.opaque, this.batches.transparent]) {
      for (const b of list) {
        gl.deleteBuffer(b.vbo);
        gl.deleteBuffer(b.ibo);
      }
    }
    this.batches = { opaque: [], transparent: [] };
    for (const raw of batches.opaque) this.batches.opaque.push(this.upload(raw));
    for (const raw of batches.transparent) this.batches.transparent.push(this.upload(raw));
  }

  upload(raw) {
    const gl = this.gl;
    const n = raw.faces.length;
    const verts = new Float32Array(n * 8 * 4); // pos3 uv2 normal3 * 4 vertices
    const idx = new Uint32Array(n * 6);
    let v = 0, ii = 0;
    for (const face of raw.faces) {
      if (face.removed) continue;
      const c = face.corners, u = face.uvs, normal = face.normal;
      for (let i = 0; i < 4; i++) {
        verts[v++] = c[i][0]; verts[v++] = c[i][1]; verts[v++] = c[i][2];
        verts[v++] = u[i][0]; verts[v++] = u[i][1];
        verts[v++] = normal[0]; verts[v++] = normal[1]; verts[v++] = normal[2];
      }
      const base = (v / 8 - 4);
      idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
      idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 3;
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    return { ...raw, vbo, ibo, count: ii, texture: this.uploadTexture(raw.image) || this.fallback };
  }

  makeFallback() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  uploadTexture(image) {
    if (typeof image === 'string') {
      if (this.textures.has(image)) return this.textures.get(image);
      const tex = this.makeFallback();
      this.textures.set(image, tex);
      if (!this.loadingTextures.has(image)) {
        this.loadingTextures.add(image);
        const img = new Image();
        img.onload = () => {
          const gl = this.gl;
          const real = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, real);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          this.textures.set(image, real);
          for (const b of this.batches.transparent) if (b.texture === tex) b.texture = real;
        };
        img.src = `minecraft/textures/${image}.png`;
      }
      return tex;
    }

    if (!image) return null;
    let tex = this.textures.get(image);
    if (tex) return tex;
    const gl = this.gl;
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.textures.set(image, tex);
    return tex;
  }

  bindGeometry(program) {
    const gl = this.gl;
    const stride = 32;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.current.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.current.ibo);
  }

  render(camera, projection, view, env) {
    const gl = this.gl;
    if (!this.fbo) return;
    const { fbo, accum, reveal } = this.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [1, 1, 1, 1]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    this.errClear = gl.getError();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.useProgram(this.programs.depth.p);
    this.setMatrices(this.programs.depth, projection, view);
    for (const b of this.batches.opaque) {
      this.current = b;
      this.bindGeometry(this.programs.depth);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
    }
    this.errDepth = gl.getError();
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(this.programs.oit.p);
    this.setMatrices(this.programs.oit, projection, view);
    const u = this.programs.oit.uniforms;
    gl.uniform3f(u.uCamera, camera.position.x, camera.position.y, camera.position.z);
    const fog = env || {};
    gl.uniform3fv(u.uFogColor, fog.color || [0, 0, 0]);
    gl.uniform1f(u.uFogNear, fog.near ?? 0);
    gl.uniform1f(u.uFogFar, fog.far ?? 10000);
    gl.uniform1i(u.uTexture, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Accumulation pass: RGB weighted color + alpha weight.
    this.errBeforeAccum = gl.getError();
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    this.errDrawBuffers = gl.getError();
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const b of this.batches.transparent) {
      this.current = b;
      this.bindGeometry(this.programs.oit);
      if (b.texture) gl.bindTexture(gl.TEXTURE_2D, b.texture);
      const tint = b.tint || [1, 1, 1, 1];
      gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3] ?? 1);
      gl.uniform1f(u.uOpacity, b.opacity ?? 1);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
    }

    this.errAccum = gl.getError();
    // Revealage pass: dst *= (1 - src.a).
    gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    this.errRevealDB = gl.getError();
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    for (const b of this.batches.transparent) {
      this.current = b;
      this.bindGeometry(this.programs.oit);
      if (b.texture) gl.bindTexture(gl.TEXTURE_2D, b.texture);
      const tint = b.tint || [1, 1, 1, 1];
      gl.uniform4f(u.uTint, tint[0], tint[1], tint[2], tint[3] ?? 1);
      gl.uniform1f(u.uOpacity, b.opacity ?? 1);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
    }
    // Composite OIT over transparent canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.programs.composite.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accum);
    gl.uniform1i(this.programs.composite.uniforms.uAccum, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, reveal);
    gl.uniform1i(this.programs.composite.uniforms.uReveal, 1);
    this.errReveal = gl.getError();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.lastError = gl.getError();
  }

  setMatrices(program, projection, view) {
    const gl = this.gl;
    gl.uniformMatrix4fv(program.uniforms.uProjection, false, projection);
    gl.uniformMatrix4fv(program.uniforms.uView, false, view);
  }
}

export function createOverlayCanvas(parent) {
  const c = document.createElement('canvas');
  c.id = 'engine-canvas';
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;image-rendering:pixelated;';
  parent.appendChild(c);
  return c;
}
