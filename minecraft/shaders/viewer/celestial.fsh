uniform sampler2D tex;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tex, vUv);
  // The vanilla celestial textures have a black background and an opaque alpha
  // channel. Feed luminance into the alpha channel and use additive blending:
  // black adds nothing (no dark square / edge halo), while the glow and moon
  // phases add light. This also avoids sorting fringes on the transparent quad.
  float lum = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c.rgb, lum);
}
