const vertexSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform vec4 ripples[6];

// Incommensurate wave directions keep the surface from moving as one pattern.
float height(vec2 p) {
  float t = time * 0.24;
#ifndef LOW_QUALITY
  p += 0.12 * sin(p.yx * 0.8 + vec2(t * 0.37, -t * 0.29));
#endif
  float h = sin(dot(p, vec2(1.3, 0.8)) + t) * 0.38;
  h += sin(dot(p, vec2(-0.7, 1.8)) - t * 1.17) * 0.26;
  h += sin(dot(p, vec2(2.4, -1.5)) + t * 0.79 + h) * 0.16;
  h += sin(dot(p, vec2(7.1, 4.3)) - t * 1.9 + h * 2.0) * 0.025;
#ifndef LOW_QUALITY
  h += sin(dot(p, vec2(3.7, 2.1)) - t * 0.63 + h * 1.4) * 0.08;
  h += sin(dot(p, vec2(-5.2, 8.7)) + t * 1.43 + h * 1.7) * 0.018;
  h += sin(dot(p, vec2(10.3, -6.1)) + t * 1.12 + h) * 0.008;
#endif
  for (int i = 0; i < 6; i++) {
    float age = time - ripples[i].z;
    if (age < 0.0 || age >= 6.0 || ripples[i].w == 0.0) continue;
    float radius = length(p - ripples[i].xy);
    float front = radius - age * 0.65;
    h += sin(front * 9.0) * exp(-front * front * 5.0)
      * exp(-age * 0.8) * smoothstep(0.0, 0.3, age)
      * (1.0 - smoothstep(4.5, 6.0, age)) * ripples[i].w;
  }
  return h;
}

// Interfering, warped wave contours keep the focused light soft and continuous.
float caustics(vec2 p, float depth) {
  float t = time * 0.16;
  p += 0.38 * sin(p.yx * 1.2 + vec2(t * 0.7, -t * 0.9));
  p += 0.18 * sin(p.yx * 2.1 + vec2(-t * 0.6, t));
  float field = sin(dot(p, vec2(1.7, 0.9)) + t)
    + sin(dot(p, vec2(-0.8, 1.9)) - t * 0.83)
    + 0.55 * sin(dot(p, vec2(2.3, -1.4)) + t * 0.61);
  float focus = 0.5 + 0.5 * sin(dot(p, vec2(0.7, -0.4)) - t * 0.3);
  float softness = mix(16.0, 7.0, clamp(depth / 2.0, 0.0, 1.0));
  return exp(-field * field * softness) * (0.45 + focus * 0.55);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0) * 7.0;
  p += pointer * 0.12;
  float h = height(p);
  vec2 slope = vec2(height(p + vec2(0.045, 0.0)) - h,
                    height(p + vec2(0.0, 0.045)) - h) / 0.045;
#ifndef LOW_QUALITY
  slope = vec2(height(p + vec2(0.045, 0.0)) - height(p - vec2(0.045, 0.0)),
               height(p + vec2(0.0, 0.045)) - height(p - vec2(0.0, 0.045))) / 0.09;
#endif
  vec3 normal = normalize(vec3(-slope * 0.32, 1.0));
  // View the surface from above, like the page is resting over a pool.
  vec3 view = vec3(0.0, 0.0, 1.0);
  float facing = max(dot(normal, view), 0.0);
  float basin = 0.5 + 0.25 * sin(p.x * 0.42 + sin(p.y * 0.38))
    + 0.25 * sin(p.y * 0.53 - p.x * 0.19);
  float waterDepth = 0.65 + uv.y * 0.75 + basin * 0.45;
  // The floor shifts beneath the surface; reflections move with the normal.
  vec2 refracted = p + slope * (0.22 + waterDepth * 0.18) - view.xy * waterDepth;
  float light = caustics(refracted * 1.15, waterDepth);
#ifndef LOW_QUALITY
  light = light * 0.7 + caustics(refracted * 1.73 + vec2(4.1, -2.8), waterDepth) * 0.3;
#endif
  float depth = smoothstep(0.0, 1.0, uv.y);
  vec3 color = mix(vec3(0.025, 0.055, 0.095), vec3(0.035, 0.135, 0.165), depth);
  color += vec3(-0.006, 0.016, 0.012) * basin;
  color += vec3(0.012, 0.032, 0.038) * (h + 0.8);
  float glow = exp(-dot((uv - vec2(0.78, 0.85)) * vec2(1.3, 1.0),
                        (uv - vec2(0.78, 0.85)) * vec2(1.3, 1.0)) * 3.0);
  color += vec3(0.05, 0.17, 0.16) * light * exp(-waterDepth * 0.55) * (0.35 + glow * 0.65);
  // Reflect a soft strip of sky across the existing wave normals.
  vec3 reflected = reflect(-view, normal);
  vec2 skyUV = reflected.xy + p * 0.035;
  float clouds = 0.5 + 0.5 * sin(skyUV.x * 2.3 + sin(skyUV.y * 2.7 + time * 0.025));
  float sky = smoothstep(-0.2, 1.0, reflected.y) * (0.7 + clouds * 0.3);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 reflection = mix(vec3(0.035, 0.075, 0.11), vec3(0.12, 0.22, 0.26), sky);
  color = mix(color, reflection, min(0.45, fresnel + sky * 0.08));
  // A broad overhead reflection avoids thin streaks along the wave crests.
  float reflectionDistance = dot(reflected.xy, reflected.xy);
  float glint = exp(-reflectionDistance * 1.8) * (0.8 + clouds * 0.2);
#ifndef LOW_QUALITY
  vec2 patch = reflected.xy - vec2(0.22, -0.12);
  float skyPatch = exp(-dot(patch * vec2(1.2, 0.8), patch * vec2(1.2, 0.8)) * 3.0);
  color += vec3(0.035, 0.05, 0.055) * skyPatch * clouds * (0.3 + glow * 0.7);
#endif
  color += vec3(0.15, 0.18, 0.18) * glint * glow;
  color *= 0.72 + 0.28 * (1.0 - smoothstep(0.1, 0.8, length(uv - 0.5)));
  gl_FragColor = vec4(color, 1.0);
}`;

export function initWater(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return () => {};

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)");
  const small = matchMedia("(max-width: 700px)");
  let limited = (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
    || (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4)
    || navigator.connection?.saveData === true;
  const lowPower = coarse.matches || small.matches || limited;
  const shaders = [];
  const program = gl.createProgram();
  let buffer;
  let frame = 0;
  let disposed = false;
  let lost = false;
  let elapsed = Math.random() * 300;
  let lastFrame = 0;
  let lastTick = 0;
  let samples = 0;
  let slowFrames = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  const ripples = new Float32Array(24);
  let nextRipple = 0;
  let drag = null;
  let replacementCleanup;

  function release() {
    if (buffer) gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
  }

  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, `${lowPower ? "#define LOW_QUALITY\n" : ""}${fragmentSource}`],
    ]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  } catch (error) {
    console.warn("Water background unavailable:", error.message);
    release();
    return () => {};
  }

  const resolution = gl.getUniformLocation(program, "resolution");
  const time = gl.getUniformLocation(program, "time");
  const pointer = gl.getUniformLocation(program, "pointer");
  const ripple = gl.getUniformLocation(program, "ripples[0]");
  let interval = 1000 / (limited ? 20 : 30);

  function draw() {
    if (disposed || lost) return;
    gl.uniform1f(time, elapsed);
    gl.uniform2f(pointer, pointerX, pointerY);
    gl.uniform4fv(ripple, ripples);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.classList.add("water-background--ready");
  }

  function resize() {
    if (disposed || lost) return;
    const mobile = lowPower || small.matches || coarse.matches;
    const scale = Math.min(devicePixelRatio || 1, 1.5) * (limited ? 0.35 : mobile ? 0.5 : 0.65);
    // Bound total fragment work even on large desktop displays.
    const width = innerWidth;
    const height = innerHeight;
    const ratio = Math.min(scale, Math.sqrt((limited ? 180_000 : mobile ? 450_000 : 1_200_000) / (width * height)));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    draw();
  }

  function render(now) {
    if (disposed || lost || document.hidden || motion.matches) {
      frame = 0;
      return;
    }
    if (now - lastFrame >= interval) {
      // Sustained missed frames catch weak GPUs that hardware hints don't describe.
      if (!limited && lastTick) {
        samples++;
        if (now - lastTick > 60) slowFrames++;
        if (samples >= 120) {
          if (slowFrames > samples * 0.4) {
            limited = true;
            interval = 1000 / 20;
            targetX = targetY = pointerX = pointerY = 0;
            resize();
          }
          samples = slowFrames = 0;
        }
      }
      if (lastTick) elapsed += Math.min((now - lastTick) / 1000, 0.1);
      lastTick = now;
      lastFrame = now - (now - lastFrame) % interval;
      pointerX += (targetX - pointerX) * 0.035;
      pointerY += (targetY - pointerY) * 0.035;
      draw();
    }
    frame = requestAnimationFrame(render);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
    samples = slowFrames = 0;
    if (limited || motion.matches || coarse.matches || small.matches) {
      targetX = targetY = pointerX = pointerY = 0;
    }
    if (motion.matches) {
      ripples.fill(0);
      drag = null;
    }
    if (document.hidden || lost || disposed) return;
    draw();
    if (!motion.matches) frame = requestAnimationFrame(render);
  }

  function interactive(event) {
    return !motion.matches
      && event.pointerType === "mouse" && !document.documentElement.hasAttribute("data-scrollbar-dragging");
  }

  function startDrag(event) {
    if (!interactive(event) || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }

  function move(event) {
    if (!interactive(event)) return;
    const x = event.clientX / innerWidth - 0.5;
    const y = 0.5 - event.clientY / innerHeight;
    if (!lowPower && !limited && !coarse.matches && !small.matches) {
      targetX = x;
      targetY = y;
    }
    if (drag && drag.id === event.pointerId
      && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
  }

  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (interactive(event) && !drag.moved && event.type === "pointerup") {
      for (let i = 0; i < 6; i++) {
        const slot = (nextRipple + i) % 6;
        const offset = slot * 4;
        if (ripples[offset + 3] !== 0 && elapsed - ripples[offset + 2] < 6) continue;
        ripples[offset] = (event.clientX / innerWidth - 0.5) * (canvas.width / canvas.height) * 7 + pointerX * 0.12;
        ripples[offset + 1] = (0.5 - event.clientY / innerHeight) * 7 + pointerY * 0.12;
        ripples[offset + 2] = elapsed;
        ripples[offset + 3] = 0.025;
        nextRipple = (slot + 1) % 6;
        break;
      }
    }
    drag = null;
  }

  function resetPointer() {
    drag = null;
    targetX = targetY = 0;
  }

  function contextLost(event) {
    event.preventDefault();
    lost = true;
    canvas.classList.remove("water-background--ready");
    sync();
  }

  function contextRestored() {
    cleanup();
    replacementCleanup = initWater(canvas);
  }

  function cleanup() {
    if (replacementCleanup) {
      replacementCleanup();
      replacementCleanup = undefined;
    }
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerdown", startDrag);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("blur", resetPointer);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", sync);
    document.removeEventListener("visibilitychange", sync);
    motion.removeEventListener("change", sync);
    coarse.removeEventListener("change", sync);
    small.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    canvas.classList.remove("water-background--ready");
    release();
  }

  function pageHide(event) {
    if (!event.persisted) cleanup();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTick = 0;
    }
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", startDrag, { passive: true });
  window.addEventListener("pointerup", endDrag, { passive: true });
  window.addEventListener("pointercancel", endDrag, { passive: true });
  window.addEventListener("blur", resetPointer);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", sync);
  document.addEventListener("visibilitychange", sync);
  motion.addEventListener("change", sync);
  coarse.addEventListener("change", sync);
  small.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  resize();
  sync();
  return cleanup;
}

initWater(document.querySelector(".water-background"));
