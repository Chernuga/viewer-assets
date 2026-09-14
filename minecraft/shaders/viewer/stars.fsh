uniform float uTime;
uniform float uNight;
uniform float uBlinkSpeed;
uniform float uBlinkAmount;

varying float vOpacity;
varying float vPhase;

void main() {
  float blink = 1.0 - uBlinkAmount * 0.5 * (1.0 - sin(uTime * uBlinkSpeed + vPhase));
  float alpha = vOpacity * blink * uNight;
  gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
}
