import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode, Renderer } from './renderer/Renderer';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  const [mode, setMode] = useState<RenderMode>('liquid');
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0.5);
  const [panY, setPanY] = useState(0.5);
  const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
  const [autoChangeDelay, setAutoChangeDelay] = useState(10);
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);

  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const loadModel = async () => {
    if (depthEstimator) {
      setStatus('AI model is already loaded.');
      return;
    }
    try {
      setStatus('Loading AI model (this may take a minute)...');
      const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas');
      setDepthEstimator(() => estimator);
      setStatus('AI Model Loaded. New images will now have depth effects.');
    } catch (e: any) {
      console.error(e);
      setStatus(`Failed to load AI model: ${e.message}`);
    }
  };

  const runDepthAnalysis = useCallback(async (imageUrl: string) => {
    if (!depthEstimator || !rendererRef.current) return;
    setStatus('Analyzing image with AI model...');
    try {
      const result = await depthEstimator(imageUrl);
      const { data, dims } = result.predicted_depth;
      const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];

      let min = Infinity, max = -Infinity;
      data.forEach((v: number) => {
        if (v < min) min = v;
        if (v > max) max = v;
      });
      const range = max - min;
      const normalizedData = new Float32Array(data.length);
      
      for (let i = 0; i < data.length; ++i) {
        normalizedData[i] = 1.0 - ((data[i] - min) / range);
      }
      
      setStatus('Updating depth map on GPU...');
      rendererRef.current.updateDepthMap(normalizedData, width, height);
      
      setDepthMapResult(result);
      setStatus('Ready.');
    } catch (e: any) {
      console.error("Error during analysis:", e);
      setStatus(`Failed to analyze image: ${e.message}`);
    }
  }, [depthEstimator]);

  const handleNewImage = useCallback(async () => {
    if (!rendererRef.current) {
        console.warn("Renderer not ready yet.");
        return;
    }
    setStatus('Loading random image...');
    const newImageUrl = await rendererRef.current.loadRandomImage();
    
    if (newImageUrl) {
        if (depthEstimator) {
            await runDepthAnalysis(newImageUrl);
        } else {
            setStatus('Ready. Load AI model to add depth effects.');
        }
    } else {
        setStatus('Failed to load a random image.');
    }
  }, [depthEstimator, runDepthAnalysis]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (autoChangeEnabled && (mode.startsWith('liquid') || mode === 'image' || mode === 'ripple')) {
      intervalId = setInterval(handleNewImage, autoChangeDelay * 1000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [autoChangeEnabled, autoChangeDelay, mode, handleNewImage]);

  useEffect(() => {
    if (depthMapResult?.predicted_depth && debugCanvasRef.current) {
      const { data, dims } = depthMapResult.predicted_depth;
      const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
      const canvas = debugCanvasRef.current;
      const context = canvas.getContext('2d');
      if (!width || !height || !context) return;
      
      canvas.width = width;
      canvas.height = height;
      const imageData = context.createImageData(width, height);

      let min = Infinity, max = -Infinity;
      data.forEach((v: number) => {
        if (v < min) min = v;
        if (v > max) max = v;
      });
      const range = max - min;
      for (let i = 0; i < data.length; ++i) {
        const value = Math.round(((data[i] - min) / range) * 255);
        imageData.data[i * 4 + 0] = value;
        imageData.data[i * 4 + 1] = value;
        imageData.data[i * 4 + 2] = value;
        imageData.data[i * 4 + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
    }
  }, [depthMapResult]);

  return (
    <div id="app-container">
      <h1>WebGPU Liquid + Depth Effect</h1>
      <p><strong>Status:</strong> {status}</p>
      <Controls
        mode={mode} setMode={setMode}
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
