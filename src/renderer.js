import { fullscreenVertex, volumeFragment, sceneFragment, postFragment } from './shaders.js';

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`${label} 编译失败：\n${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function createProgram(gl, fragment, label) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, fullscreenVertex, `${label} vertex`));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment, `${label} fragment`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`${label} 链接失败：\n${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function createFloatTexture(gl, width, height, filter = gl.LINEAR) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  return texture;
}

function createFramebuffer(gl, texture) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('当前设备不支持所需的浮点帧缓冲。');
  }
  return framebuffer;
}

function uniforms(gl, program, names) {
  return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
}

export function createMetamorphosisRenderer(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('此浏览器或显卡不支持 WebGL 2。');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('当前设备不支持 EXT_color_buffer_float。');
  }

  const volumeProgram = createProgram(gl, volumeFragment, 'Volume Pass');
  const sceneProgram = createProgram(gl, sceneFragment, 'Scene Pass');
  const postProgram = createProgram(gl, postFragment, 'Image Pass');
  const volumeUniforms = uniforms(gl, volumeProgram, ['uPrevious', 'uMorph', 'uSize', 'uGrid']);
  const sceneUniforms = uniforms(gl, sceneProgram, ['uVolume', 'uResolution', 'uTime', 'uMorph', 'uSize', 'uGrid']);
  const postUniforms = uniforms(gl, postProgram, ['uScene', 'uResolution', 'uTime']);

  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  for (const program of [volumeProgram, sceneProgram, postProgram]) {
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  // 128 slices in a 16×8 atlas: 2048×1024 texels = 128³ voxels.
  const volumeSize = 128;
  const gridWidth = 16;
  const gridHeight = 8;
  const atlasWidth = volumeSize * gridWidth;
  const atlasHeight = volumeSize * gridHeight;
  const volumeTextures = [
    createFloatTexture(gl, atlasWidth, atlasHeight, gl.NEAREST),
    createFloatTexture(gl, atlasWidth, atlasHeight, gl.NEAREST),
  ];
  const volumeFrames = volumeTextures.map(texture => createFramebuffer(gl, texture));

  // A large positive first frame prevents uninitialized texels becoming phantom surfaces.
  for (const frame of volumeFrames) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.viewport(0, 0, atlasWidth, atlasHeight);
    gl.clearColor(4, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  let sceneTexture;
  let sceneFrame;
  let screenWidth = 0;
  let screenHeight = 0;
  let volumeIndex = 0;
  let quality = options.quality ?? 0.72;
  let paused = false;
  let automaticMorph = true;
  let manualMorph = 0;
  let animationFrame = 0;
  let startTime = performance.now();
  let elapsed = 0;
  let lastUiUpdate = 0;

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
    sceneTexture = createFloatTexture(gl, width, height, gl.LINEAR);
    sceneFrame = createFramebuffer(gl, sceneTexture);
  }

  function bindTexture(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function morphAt(time) {
    if (!automaticMorph) return manualMorph;
    const phase = ((time / 40) % 1 + 1) % 1;
    const up = Math.max(0, Math.min(1, (phase - 0.2) / 0.2));
    const down = Math.max(0, Math.min(1, (phase - 0.75) / 0.2));
    return up * up * (3 - 2 * up) - down * down * (3 - 2 * down);
  }

  function draw(now) {
    resize();
    if (!paused) elapsed = (now - startTime) / 1000;
    const morph = morphAt(elapsed);

    // Pass 1: update every voxel in the 8×8 slice atlas using last frame as input.
    gl.useProgram(volumeProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, volumeFrames[1 - volumeIndex]);
    gl.viewport(0, 0, atlasWidth, atlasHeight);
    bindTexture(0, volumeTextures[volumeIndex]);
    gl.uniform1i(volumeUniforms.uPrevious, 0);
    gl.uniform1f(volumeUniforms.uMorph, morph);
    gl.uniform1f(volumeUniforms.uSize, volumeSize);
    gl.uniform2f(volumeUniforms.uGrid, gridWidth, gridHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    volumeIndex = 1 - volumeIndex;

    // Pass 2: ray march the volume and render sky/water into an HDR RGBA target.
    gl.useProgram(sceneProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrame);
    gl.viewport(0, 0, screenWidth, screenHeight);
    bindTexture(0, volumeTextures[volumeIndex]);
    gl.uniform1i(sceneUniforms.uVolume, 0);
    gl.uniform2f(sceneUniforms.uResolution, screenWidth, screenHeight);
    gl.uniform1f(sceneUniforms.uTime, elapsed);
    gl.uniform1f(sceneUniforms.uMorph, morph);
    gl.uniform1f(sceneUniforms.uSize, volumeSize);
    gl.uniform2f(sceneUniforms.uGrid, gridWidth, gridHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 3: depth of field, bloom, god rays, grade and letterbox.
    gl.useProgram(postProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, screenWidth, screenHeight);
    bindTexture(0, sceneTexture);
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
