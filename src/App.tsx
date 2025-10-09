import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  const [mode, setMode] = useState<RenderMode>('3d-zoom');
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // --- CONSOLIDATED STATE FOR BOTH MODES ---
  // State for 3D Zoom
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [depthThreshold, setDepthThreshold] = useState(0.5);
  const [edgeHardness, setEdgeHardness] = useState(0.5);
  const [depthLevels, setDepthLevels] = useState(5);
  const [fogColor, setFogColor] = useState('#202025');
  const [fogDensity, setFogDensity] = useState(4.0);
  const [parallaxStrength, setParallaxStrength] = useState(0.05);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [depthDimensions, setDepthDimensions] = useState({ width: 1, height: 1 });
  
  // State for 3D Parallax
  const [displacementScale, setDisplacementScale] = useState(0.3);
  const [ambientLight, setAmbientLight] = useState(0.2);
  const [smoothness, setSmoothness] = useState(1.0);
  const [pointSize, setPointSize] = useState(3.0);
    
  // --- FIXED: Code was missing its useEffect wrapper ---
  useEffect(() => {
    rendererRef.current?.updateParallaxParams({
        displacementScale, ambient: ambientLight, smoothness, pointSize
    });
  }, [displacementScale, ambientLight, smoothness, pointSize]);

  // All other functions (loadModel, findOptimalThreshold, runDepthAnalysis, handleNewImage) are correct and do not need changes.
  // [Omitted for brevity]
  const loadModel = async () => { /* ... */ };
  const findOptimalThreshold = (data: Float32Array): number => { /* ... */ };
  const runDepthAnalysis = useCallback(async (imageUrl: string) => { /* ... */ }, [depthEstimator]);
  const handleNewImage = useCallback(async () => { /* ... */ }, [depthEstimator, runDepthAnalysis]);

  useEffect(() => {
    // ... (debug canvas useEffect is unchanged)
  }, [depthMapResult]);

  return (
    <div id="app-container">
      <h1>WebGPU Depth Effects</h1>
      <p><strong>Status:</strong> {status}</p>
      <Controls
        mode={mode} setMode={setMode}
        onNewImage={handleNewImage}
        onLoadModel={loadModel}
        isModelLoaded={!!depthEstimator}
        // Props for 3D Zoom
        depthThreshold={depthThreshold} setDepthThreshold={setDepthThreshold}
        edgeHardness={edgeHardness} setEdgeHardness={setEdgeHardness}
        depthLevels={depthLevels} setDepthLevels={setDepthLevels}
        fogColor={fogColor} setFogColor={setFogColor}
        fogDensity={fogDensity} setFogDensity={setFogDensity}
        parallaxStrength={parallaxStrength} setParallaxStrength={setParallaxStrength}
        // Props for 3D Parallax
        displacementScale={displacementScale} setDisplacementScale={setDisplacementScale}
        ambientLight={ambientLight} setAmbientLight={setAmbientLight}
        smoothness={smoothness} setSmoothness={setSmoothness}
        pointSize={pointSize} setPointSize={setPointSize}
      />
      <WebGPUCanvas
        rendererRef={rendererRef}
        mode={mode}
        // Props passed to the canvas
        farthestPoint={farthestPoint}
        depthThreshold={depthThreshold}
        edgeHardness={edgeHardness}
        depthLevels={depthLevels}
        imageDimensions={imageDimensions}
        depthDimensions={depthDimensions}
        fogColor={fogColor}
        fogDensity={fogDensity}
        parallaxStrength={parallaxStrength}
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
