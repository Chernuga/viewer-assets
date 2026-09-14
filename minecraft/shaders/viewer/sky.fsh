uniform sampler2D skyTexture;
uniform float currentState;
uniform float nextState;
uniform float blend;
uniform float stateCount;
uniform float brightness;
uniform float saturation;
varying vec2 vUv;

vec4 sampleState(float stateIndex, float localV, float uCoord) {
  float stateHeight = 1.0 / stateCount;
  float vMin = 1.0 - (stateIndex + 1.0) * stateHeight;
  float vMax = 1.0 - stateIndex * stateHeight;
  float uMirror = uCoord * 2.0;
  return texture2D(skyTexture, vec2(uMirror, mix(vMin, vMax, localV)));
}

vec3 adjustColor(vec3 color) {
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, saturation);
  color *= brightness;
  return color;
}

void main() {
  vec4 a = sampleState(currentState, vUv.y, vUv.x);
  vec4 b = sampleState(nextState, vUv.y, vUv.x);
  vec4 mixed = mix(a, b, blend);
  gl_FragColor = vec4(adjustColor(mixed.rgb), mixed.a);
}
