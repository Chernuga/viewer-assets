uniform sampler2D tex;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tex, vUv);
  float lum = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c.rgb, lum);
}
