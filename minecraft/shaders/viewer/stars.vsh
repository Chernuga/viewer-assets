attribute float starOpacity;
attribute float starPhase;

varying float vOpacity;
varying float vPhase;

void main() {
  vOpacity = starOpacity;
  vPhase = starPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
