import { fullscreenVertex, volumeFragment, sceneFragment, postFragment } from './shaders.js';

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

function createProgram(gl, fragment, label) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, fullscreenVertex, `${label} vertex`));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment, `${label} fragment`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${label}: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function createTexture2D(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  return texture;
}

function createTexture3D(gl, size) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
  return texture;
}

function createFramebuffer2D(gl, texture) {
  const frame = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('2D float framebuffer unsupported');
  return frame;
}

function uniformLocations(gl, program, names) {
  return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
}

export function createMetamorphosisRenderer(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL 2 is required');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required');

  const volumeProgram = createProgram(gl, volumeFragment, 'Volume Pass');
  const sceneProgram = createProgram(gl, sceneFragment, 'Scene Pass');
  const postProgram = createProgram(gl, postFragment, 'Image Pass');
  const volumeUniforms = uniformLocations(gl, volumeProgram, ['uPrevious', 'uMorph', 'uSize', 'uLayer']);
  const sceneUniforms = uniformLocations(gl, sceneProgram, ['uVolume', 'uResolution', 'uTime', 'uMorph', 'uSize']);
  const postUniforms = uniformLocations(gl, postProgram, ['uScene', 'uResolution', 'uTime']);

  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const program of [volumeProgram, sceneProgram, postProgram]) {
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  const requestedSize = Number(new URLSearchParams(location.search).get('volume'));
  const volumeSize = requestedSize === 64 ? 64 : 128;
  const volumeTextures = [createTexture3D(gl, volumeSize), createTexture3D(gl, volumeSize)];
  const volumeFrames = [gl.createFramebuffer(), gl.createFramebuffer()];

  // Initialize every layer to a positive distance.
  for (let textureIndex = 0; textureIndex < 2; textureIndex++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, volumeFrames[textureIndex]);
    gl.viewport(0, 0, volumeSize, volumeSize);
    for (let layer = 0; layer < volumeSize; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, volumeTextures[textureIndex], 0, layer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('3D float framebuffer unsupported');
      gl.clearColor(4, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  let sceneTexture = null;
  let sceneFrame = null;
  let screenWidth = 0;
  let screenHeight = 0;
  let volumeIndex = 0;
  let volumeIterations = 0;
  let previousMorph = Number.NaN;
  let quality = options.quality ?? 0.72;
  let paused = false;
  let automaticMorph = options.initialAutoMorph ?? true;
  let manualMorph = options.initialMorph ?? 0;
  let animationFrame = 0;
  let startTime = performance.now();
  let elapsed = 0;
  let lastUiUpdate = 0;
  const fixedTime = Number.isFinite(options.fixedTime) ? options.fixedTime : null;

  function resize() {
    const scale = Math.min(devicePixelRatio, 1.5) * quality;
    const width = Math.max(2, Math.floor(innerWidth * scale));
    const height = Math.max(2, Math.floor(innerHeight * scale));
    if (width === screenWidth && height === screenHeight) return;
    screenWidth = width;
    screenHeight = height;
    canvas.width = width;
    canvas.height = height;
    if (sceneTexture) gl.deleteTexture(sceneTexture);
    if (sceneFrame) gl.deleteFramebuffer(sceneFrame);
    sceneTexture = createTexture2D(gl, width, height);
    sceneFrame = createFramebuffer2D(gl, sceneTexture);
  }

  function bind2D(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function bind3D(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, texture);
  }

  function morphAt(time) {
    if (!automaticMorph) return manualMorph;
    const phase = ((time / 40) % 1 + 1) % 1;
    const rise = Math.max(0, Math.min(1, (phase - 0.2) / 0.2));
    const fall = Math.max(0, Math.min(1, (phase - 0.75) / 0.2));
    const smoothRise = rise * rise * (3 - 2 * rise);
    const smoothFall = fall * fall * (3 - 2 * fall);
    return smoothRise - smoothFall;
  }

  function draw(now) {
    resize();
    if (fixedTime !== null) elapsed = fixedTime;
    else if (!paused) elapsed = (now - startTime) / 1000;
    const morph = morphAt(elapsed);
    const changing = !Number.isFinite(previousMorph) || Math.abs(morph - previousMorph) > 1e-5;

    // Shadertoy mainVolume equivalent: one render per Z layer into a real 3D texture.
    if (volumeIterations < 128 || changing) {
      gl.useProgram(volumeProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, volumeFrames[1 - volumeIndex]);
      gl.viewport(0, 0, volumeSize, volumeSize);
      bind3D(0, volumeTextures[volumeIndex]);
      gl.uniform1i(volumeUniforms.uPrevious, 0);
      gl.uniform1f(volumeUniforms.uMorph, morph);
      gl.uniform1f(volumeUniforms.uSize, volumeSize);
      for (let layer = 0; layer < volumeSize; layer++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, volumeTextures[1 - volumeIndex], 0, layer);
        gl.uniform1f(volumeUniforms.uLayer, layer);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      volumeIndex = 1 - volumeIndex;
      volumeIterations += 1;
      previousMorph = morph;
    }

    gl.useProgram(sceneProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrame);
    gl.viewport(0, 0, screenWidth, screenHeight);
    bind3D(0, volumeTextures[volumeIndex]);
    gl.uniform1i(sceneUniforms.uVolume, 0);
    gl.uniform2f(sceneUniforms.uResolution, screenWidth, screenHeight);
    gl.uniform1f(sceneUniforms.uTime, elapsed);
    gl.uniform1f(sceneUniforms.uMorph, morph);
    gl.uniform1f(sceneUniforms.uSize, volumeSize);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(postProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, screenWidth, screenHeight);
    bind2D(0, sceneTexture);
    gl.uniform1i(postUniforms.uScene, 0);
    gl.uniform2f(postUniforms.uResolution, screenWidth, screenHeight);
    gl.uniform1f(postUniforms.uTime, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (now - lastUiUpdate > 100) {
      options.onMorph?.(morph);
      lastUiUpdate = now;
    }
    animationFrame = requestAnimationFrame(draw);
  }

  return {
    start() { animationFrame = requestAnimationFrame(draw); },
    destroy() {
      cancelAnimationFrame(animationFrame);
      [volumeProgram, sceneProgram, postProgram].forEach(program => gl.deleteProgram(program));
      volumeTextures.forEach(texture => gl.deleteTexture(texture));
      volumeFrames.forEach(frame => gl.deleteFramebuffer(frame));
      gl.deleteTexture(sceneTexture);
      gl.deleteFramebuffer(sceneFrame);
      gl.deleteBuffer(triangle);
    },
    setPaused(value) {
      if (paused && !value) startTime = performance.now() - elapsed * 1000;
      paused = value;
    },
    setAutoMorph(value) { automaticMorph = value; },
    setMorph(value) { if (!automaticMorph) manualMorph = value; },
    setQuality(value) { quality = value; screenWidth = 0; },
  };
}
