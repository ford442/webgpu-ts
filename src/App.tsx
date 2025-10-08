import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  const [mode, setMode] = useState<RenderMode>('3d-zoom');
  // --- REMOVED: Unused useState hooks for zoom, pan, and auto-change ---
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [depthThreshold, setDepthThreshold] = useState(0.5);
  const [edgeHardness, setEdgeHardness] = useState(0.5);
  const [depthLevels, setDepthLevels] = useState(5);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });

  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const loadModel = async () => {
      // ... (this function is unchanged)
  };

const findOptimalThreshold = (data: Float32Array): number => {
    const binCount = 256;
    const histogram = new Array(binCount).fill(0);

    for (let i = 0; i < data.length; ++i) {
        const bin = Math.min(Math.floor(data[i] * binCount), binCount - 1);
        histogram[bin]++;
    }

    const totalPixels = data.length;
    let bestThreshold = 0;
    let maxVariance = 0;

    let sum = 0;
    for (let i = 0; i < binCount; i++) {
        sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;

    for (let t = 0; t < binCount; t++) {
        wB += histogram[t];
        if (wB === 0) continue;

        wF = totalPixels - wB;
        if (wF === 0) break;

        sumB += t * histogram[t];

        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;

        const variance = wB * wF * (mB - mF) * (mB - mF);

        if (variance > maxVariance) {
            maxVariance = variance;
            bestThreshold = t;
        }
   }
    return bestThreshold / binCount;
  };

  const runDepthAnalysis = useCallback(async (imageUrl: string) => {
      // ... (this function is unchanged)
  }, [depthEstimator]);

  const handleNewImage = useCallback(async () => {
    if (!rendererRef.current) {
        console.warn("Renderer not ready yet.");
        return;
    }
    setStatus('Loading random image...');
    const newImageUrl = await rendererRef.current.loadRandomImage();
    
    if (newImageUrl) {
        const dims = rendererRef.current.getImageDimensions();
        if (dims) {
            setImageDimensions(dims);
        }
        if (depthEstimator) {
            await runDepthAnalysis(newImageUrl);
        } else {
            setFarthestPoint({ x: 0.5, y: 0.5 });
            setStatus('Ready. Load AI model to add depth effects.');
        }
    } else {
        setStatus('Failed to load a random image.');
    }
  }, [depthEstimator, runDepthAnalysis]);

  useEffect(() => {
    // This useEffect for the debug canvas is unchanged
  }, [depthMapResult]);

  return (
    <div id="app-container">
      <h1>WebGPU Liquid + Depth Effect</h1>
      <p><strong>Status:</strong> {status}</p>
      {/* --- FIXED: Removed unused props from the Controls component --- */}
      <Controls
        mode={mode} setMode={setMode}
        onNewImage={handleNewImage}
        onLoadModel={loadModel}
        isModelLoaded={!!depthEstimator}
        depthThreshold={depthThreshold}
        setDepthThreshold={setDepthThreshold}
        edgeHardness={edgeHardness}
        setEdgeHardness={setEdgeHardness}
        depthLevels={depthLevels}
        setDepthLevels={setDepthLevels}
      />
      <WebGPUCanvas
        rendererRef={rendererRef}
        mode={mode}
        farthestPoint={farthestPoint}
        depthThreshold={depthThreshold}
        edgeHardness={edgeHardness}
        depthLevels={depthLevels}
        imageDimensions={imageDimensions}
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
