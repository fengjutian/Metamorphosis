import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { createMetamorphosisRenderer } from './renderer.js';

function App() {
  const query = new URLSearchParams(window.location.search);
  const requestedVolumeSize = Number(query.get('volume'));
  const volumeSize = [32, 64, 128].includes(requestedVolumeSize) ? requestedVolumeSize : 64;
  const initialMorph = Math.max(0, Math.min(1, Number(query.get('morph')) || 0));
  const hasFixedMorph = query.has('morph');
  const fixedTime = query.has('time') ? Math.max(0, Number(query.get('time')) || 0) : null;
  const cleanView = query.get('clean') === '1';
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [autoMorph, setAutoMorph] = useState(!hasFixedMorph);
  const [morph, setMorph] = useState(initialMorph);
  const [quality, setQuality] = useState(0.72);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      rendererRef.current = createMetamorphosisRenderer(canvasRef.current, {
        quality,
        initialAutoMorph: !hasFixedMorph,
        initialMorph,
        fixedTime,
        onMorph: setMorph,
      });
      rendererRef.current.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => rendererRef.current?.destroy();
  }, []);

  useEffect(() => rendererRef.current?.setPaused(paused), [paused]);
  useEffect(() => rendererRef.current?.setAutoMorph(autoMorph), [autoMorph]);
  useEffect(() => rendererRef.current?.setMorph(morph), [morph, autoMorph]);
  useEffect(() => rendererRef.current?.setQuality(quality), [quality]);

  return (
    <main>
      <canvas ref={canvasRef} aria-label="莲花体积着色器动画" />
      {!cleanView && <div className="grain" />}
      {!cleanView && <header>
        <div className="eyebrow">REAL-TIME WEBGL STUDY · 2026</div>
        <h1>METAMORPHOSIS</h1>
        <p>从湍流星体，到水上莲花。</p>
      </header>}

      {!cleanView && <aside className="panel">
        <div className="panel-head">
          <span>{volumeSize}³ VOLUME</span><span className="live"><i /> LIVE</span>
        </div>
        <label className="row switch-row">
          <span>自动形变</span>
          <input type="checkbox" checked={autoMorph} onChange={e => setAutoMorph(e.target.checked)} />
        </label>
        <label>
          <span className="label"><b>形变</b><em>{Math.round(morph * 100)}%</em></span>
          <input type="range" min="0" max="1" step="0.001" value={morph}
            disabled={autoMorph} onChange={e => setMorph(Number(e.target.value))} />
        </label>
        <label>
          <span className="label"><b>渲染比例</b><em>{Math.round(quality * 100)}%</em></span>
          <input type="range" min="0.4" max="1" step="0.05" value={quality}
            onChange={e => setQuality(Number(e.target.value))} />
        </label>
        <button onClick={() => setPaused(v => !v)}>{paused ? '继续播放' : '暂停画面'}</button>
      </aside>}

      {!cleanView && <footer><span>VOLUME / SDF / REFRACTION</span><span>40 SEC LOOP</span></footer>}
      {error && <div className="error"><strong>WebGL 初始化失败</strong><br />{error}</div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
