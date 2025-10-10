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
    const [modelQuantized, setModelQuantized] = useState(false); // NEW STATE

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


  const loadModel = async () => {
        if (depthEstimator) {
            setStatus('AI model is already loaded.');
            return;
        }
        try {
            setStatus('Loading AI model (this may take a minute)...');
            const estimator = await pipeline(
                'depth-estimation', 
                'Xenova/dpt-hybrid-midas',
                { quantized: modelQuantized } // Use the state here
            );
            setDepthEstimator(() => estimator);
            setStatus('AI Model Loaded. New images will now have depth effects.');
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load AI model: ${e.message}`);
        }
    };

   const handleSetModelQuantized = (quantized: boolean) => {
        if (depthEstimator) {
            setDepthEstimator(null); // Unload the current model
            setStatus('Model type changed. Please click "Load AI Model" again.');
        }
        setModelQuantized(quantized);
    };
  
  const runDepthAnalysis = useCallback(async (imageUrl: string) => {
    if (!depthEstimator || !rendererRef.current) return;
    setStatus('Analyzing image with AI model...');
    try {
      const result = await depthEstimator(imageUrl);
      const { data, dims } = result.predicted_depth;
      const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
      let min = Infinity, max = -Infinity;
      let minIndex = 0; // Keep track of the index of the minimum depth value
      data.forEach((v: number, i: number) => {
        if (v < min) {
          min = v;
          minIndex = i; // Found a new minimum, store its index
        }
        if (v > max) max = v;
      });
      // Calculate the UV coordinates of the farthest point
      const farthestY = Math.floor(minIndex / width);
      const farthestX = minIndex % width;
      setFarthestPoint({ x: farthestX / width, y: farthestY / height });
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
            // --- MODIFIED: Start of changes ---
            // Reset farthest point if not using AI model
            setFarthestPoint({ x: 0.5, y: 0.5 });
            // --- MODIFIED: End of changes ---
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
                modelQuantized={modelQuantized} // Pass new state down
                setModelQuantized={handleSetModelQuantized} // Pass new handler down
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
