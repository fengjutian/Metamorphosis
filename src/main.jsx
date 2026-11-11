import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { createMetamorphosisRenderer } from './renderer.js';

function App() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [autoMorph, setAutoMorph] = useState(true);
  const [morph, setMorph] = useState(0);
  const [quality, setQuality] = useState(0.72);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      rendererRef.current = createMetamorphosisRenderer(canvasRef.current, {
        quality,
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
      <div className="grain" />
      <header>
        <div className="eyebrow">REAL-TIME WEBGL STUDY · 2026</div>
        <h1>METAMORPHOSIS</h1>
        <p>从湍流星体，到水上莲花。</p>
      </header>

      <aside className="panel">
        <div className="panel-head">
          <span>128³ VOLUME</span><span className="live"><i /> LIVE</span>
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
      </aside>

      <footer><span>VOLUME / SDF / REFRACTION</span><span>40 SEC LOOP</span></footer>
      {error && <div className="error"><strong>WebGL 初始化失败</strong><br />{error}</div>}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
