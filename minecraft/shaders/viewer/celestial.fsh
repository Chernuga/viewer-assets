uniform sampler2D tex;
varying vec2 vUv;

void main() {
  vec4 c = texture2D(tex, vUv);
  // The vanilla celestial textures have a black background and a fully opaque
  // alpha channel. Treat non-black pixels as the disc; this keeps the moon
  // phases opaque instead of letting dark maria turn translucent.
  float lum = max(c.r, max(c.g, c.b));
  float alpha = smoothstep(0.04, 0.10, lum);
  gl_FragColor = vec4(c.rgb, alpha);
}
