import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls, { ModelDType } from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';

import './style.css';

function App() {
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
  const [modelDtype, setModelDtype] = useState<ModelDType>('fp32'); // MODIFIED STATE
  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true); // App now controls loading

  const setMode = useCallback((newMode: RenderMode) => {
    _setMode(newMode);
    if (rendererRef.current) {
        rendererRef.current.setMode(newMode);
    }
  }, []);

  useEffect(() => {
    if (rendererRef.current) {
        setMode(mode);
    }
  }, [rendererRef.current]); // Dependency on the renderer being assigned

  const loadModel = async () => {
        if (depthEstimator) {
            setStatus('AI model is already loaded.');
            return;
        }
       try {
            setStatus(`Loading AI model (${modelDtype})...`);
            
            // --- MODIFIED: The dtype is now passed directly from state ---
            const estimator = await pipeline(
                'depth-estimation', 
                'Xenova/dpt-hybrid-midas',
                { dtype: modelDtype } 
            );
            setDepthEstimator(() => estimator);
            setStatus(`AI Model Loaded (${modelDtype}). New images will have depth effects.`);
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load AI model: ${e.message}`);
        }
    };

    const handleSetModelDtype = (dtype: ModelDType) => {
        if (depthEstimator) {
            setDepthEstimator(null); // Unload the current model
            setStatus('Model type changed. Please click "Load AI Model" again.');
        }
        setModelDtype(dtype);
    };
  
  const runDepthAnalysis = useCallback(async (imageUrl: string) => {
    if (!depthEstimator || !rendererRef.current) return;
    setIsLoading(true); // PAUSE RENDER
    setStatus('Analyzing image with AI...');
    try {
      const result = await depthEstimator(imageUrl);
      const { data, dims } = result.predicted_depth;
      const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
      const range = Math.max(...data) - Math.min(...data);
      const normalizedData = new Float32Array(data.map((v: number) => 1.0 - ((v - Math.min(...data)) / range)));
      setStatus('Updating depth map...');
      await rendererRef.current.updateDepthMap(normalizedData, width, height);
      setStatus('Ready.');
    } catch (e: any) {
      console.error("Error during analysis:", e);
      setStatus(`Failed to analyze image: ${e.message}`);
    } finally {
      setIsLoading(false); // RESUME RENDER
    }
  }, [depthEstimator]);

  const handleNewImage = useCallback(async () => {
    if (!rendererRef.current) return;
    setIsLoading(true); // PAUSE RENDER
    setStatus('Loading random image...');
    try {
        const newImageUrl = await rendererRef.current.loadRandomImage();
        if (newImageUrl && depthEstimator) {
            // runDepthAnalysis will set loading to false when it's done
            await runDepthAnalysis(newImageUrl); 
        } else if (newImageUrl) {
            setStatus('Ready.');
            setIsLoading(false); // RESUME RENDER
        } else {
            setStatus('Failed to load a random image.');
            setIsLoading(false); // RESUME RENDER
        }
    } catch (e) {
        setStatus('Failed to load image.');
        setIsLoading(false); // RESUME RENDER
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
        modelDtype={modelDtype}
        setModelDtype={handleSetModelDtype}
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
        isLoading={isLoading} // Pass loading state down
        onReady={() => setIsLoading(false)} // Callback to resume render after init
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
