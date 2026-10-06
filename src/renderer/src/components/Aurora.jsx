'use client';

import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';

import './Aurora.css';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform float uLightMode;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ), 
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
  int index = 0;                                            \
  for (int i = 0; i < 2; i++) {                               \
     ColorStop currentColor = colors[i];                    \
     bool isInBetween = currentColor.position <= factor;    \
     index = int(mix(float(index), float(i), float(isInBetween))); \
  }                                                         \
  ColorStop currentColor = colors[index];                   \
  ColorStop nextColor = colors[index + 1];                  \
  float range = nextColor.position - currentColor.position; \
  float lerpFactor = (factor - currentColor.position) / range; \
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  
  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);
  
  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);
  
  // Multi-frequency smooth simplex noise waves
  float n1 = snoise(vec2(uv.x * 1.5 + uTime * 0.12, uTime * 0.16));
  float n2 = snoise(vec2(uv.x * 2.8 - uTime * 0.14, uv.y * 1.4 + n1 * 0.4));
  float n3 = snoise(vec2(uv.x * 0.9 + uTime * 0.08, uv.y * 0.7));
  
  // Dynamic flowing ribbon paths across the screen
  float wave1 = sin(uv.x * 2.4 + uTime * 0.18 + n1 * 1.1) * 0.20 * uAmplitude;
  float wave2 = cos(uv.x * 1.7 - uTime * 0.12 + n2 * 0.7) * 0.16 * uAmplitude;
  
  // Distance to undulating aurora ribbons
  float dist1 = abs(uv.y - (0.52 + wave1));
  float dist2 = abs(uv.y - (0.34 + wave2 + n3 * 0.08));
  
  // Exponential luminous glow falloff
  float glow1 = exp(-dist1 * 3.0);
  float glow2 = exp(-dist2 * 3.4);
  float ambientGlow = exp(-abs(uv.y - 0.48) * 1.4) * 0.45;
  
  float totalIntensity = clamp(glow1 * 1.1 + glow2 * 0.9 + ambientGlow, 0.05, 1.3);
  
  // Rich chromatic blending
  vec3 auroraColor = rampColor * totalIntensity;
  
  if (uLightMode > 0.5) {
    float energy = clamp(max(totalIntensity, 0.0), 0.0, 1.0);
    vec3 chroma = pow(clamp(rampColor, 0.0, 1.0), vec3(1.2));
    fragColor = vec4(mix(vec3(1.0), chroma, energy * 0.8), 1.0);
  } else {
    fragColor = vec4(auroraColor, clamp(totalIntensity * 0.9, 0.25, 0.98));
  }
}
`;

export default function Aurora(props) {
  const { colorStops = ['#5227FF', '#7cff67', '#5227FF'], amplitude = 1.0, blend = 0.5, lightMode = false } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  const ctnDom = useRef(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = 'transparent';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.display = 'block';

    let program;

    function resize() {
      if (!ctn) return;
      const width = ctn.offsetWidth || window.innerWidth || 800;
      const height = ctn.offsetHeight || window.innerHeight || 600;
      renderer.setSize(width, height);
      if (program) {
        program.uniforms.uResolution.value = [width, height];
      }
    }
    window.addEventListener('resize', resize);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv;
    }

    const colorStopsArray = new Float32Array(
      colorStops.flatMap(hex => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      })
    );

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStopsArray },
        uResolution: { value: [ctn.offsetWidth || window.innerWidth || 800, ctn.offsetHeight || window.innerHeight || 600] },
        uBlend: { value: blend },
        uLightMode: { value: lightMode ? 1 : 0 }
      }
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(gl.canvas);
    resize();

    let animateId = 0;
    let lastFrameTime = 0;
    const targetInterval = 1000 / 30; // 30 fps cap for GPU/CPU conservation

    const update = t => {
      animateId = requestAnimationFrame(update);
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      if (t - lastFrameTime < targetInterval) {
        return;
      }
      lastFrameTime = t;

      const { time = t * 0.01, speed = 1.0 } = propsRef.current;
      program.uniforms.uTime.value = time * speed * 0.1;
      program.uniforms.uAmplitude.value = propsRef.current.amplitude ?? 1.0;
      program.uniforms.uBlend.value = propsRef.current.blend ?? blend;
      program.uniforms.uLightMode.value = (propsRef.current.lightMode ?? lightMode) ? 1 : 0;
      const stops = propsRef.current.colorStops ?? colorStops;
      program.uniforms.uColorStops.value = new Float32Array(
        stops.flatMap(hex => {
          const c = new Color(hex);
          return [c.r, c.g, c.b];
        })
      );
      renderer.render({ scene: mesh });
    };
    animateId = requestAnimationFrame(update);

    resize();

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener('resize', resize);
      if (ctn && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amplitude, blend, lightMode]);

  return <div ref={ctnDom} className="aurora-container" />;
}
