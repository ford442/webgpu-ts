import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  // Use _setMode for the raw state setter
  const [mode, _setMode] = useState<RenderMode>('liquid-v1');
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0.5);
  const [panY, setPanY] = useState(0.5);
  const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
  const [autoChangeDelay, setAutoChangeDelay] = useState(10);
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [mousePosition, setMousePosition] = useState({ x: -1, y: -1 });
  const [isMouseDown, setIsMouseDown] = useState(false);

  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- MODIFIED: Create a new setMode function ---
  // This function updates the React state AND tells the renderer to load the new mode module.
  const setMode = useCallback((newMode: RenderMode) => {
    _setMode(newMode);
    if (rendererRef.current) {
        rendererRef.current.setMode(newMode);
    }
  }, []); // rendererRef is stable, so no dependencies needed

  // --- MODIFIED: useEffect to initialize the first mode ---
  // This effect runs once when the renderer is ready.
  useEffect(() => {
    // Check if the renderer has been initialized in WebGPUCanvas
    if (rendererRef.current) {
        // Set the initial mode
        setMode(mode);
    }
  }, [rendererRef.current]); // Dependency on the renderer being assigned

  const loadModel = async () => { /* ... existing code ... */ };
  const runDepthAnalysis = useCallback(async (imageUrl: string) => { /* ... existing code ... */ }, [depthEstimator]);
  const handleNewImage = useCallback(async () => { /* ... existing code ... */ }, [depthEstimator, runDepthAnalysis]);

  useEffect(() => { /* ... existing auto-change logic ... */ }, [autoChangeEnabled, autoChangeDelay, mode, handleNewImage]);
  useEffect(() => { /* ... existing debug canvas logic ... */ }, [depthMapResult]);

  return (
    <div id="app-container">
      <h1>WebGPU Liquid + Depth Effect</h1>
      <p><strong>Status:</strong> {status}</p>
      <Controls
        mode={mode} setMode={setMode} // Pass the new setMode function
        zoom={zoom} setZoom={setZoom}
        panX={panX} setPanX={setPanX}
        panY={panY} setPanY={setPanY}
        onNewImage={handleNewImage}
        autoChangeEnabled={autoChangeEnabled}
        setAutoChangeEnabled={setAutoChangeEnabled}
        autoChangeDelay={autoChangeDelay}
        setAutoChangeDelay={setAutoChangeDelay}
        onLoadModel={loadModel}
        isModelLoaded={!!depthEstimator}
      />
       <WebGPUCanvas
        rendererRef={rendererRef}
        mode={mode}
        zoom={zoom}
        panX={panX}
        panY={panY}
        farthestPoint={farthestPoint}
        mousePosition={mousePosition}
        setMousePosition={setMousePosition}
        isMouseDown={isMouseDown}
        setIsMouseDown={setIsMouseDown}
      />
      {depthMapResult && (
        <div className="debug-container">
          <h2>AI Model Output (Debug Depth Map)</h2>
          <canvas ref={debugCanvasRef} style={{ maxWidth: '100%', height: 'auto', border: '1px solid grey' }} />
        </div>
      )}
    </div>
  );
}

export default App;
