import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  // Hardcode the mode to '3d-zoom'. No more mode switching.
  const mode: RenderMode = '3d-zoom';
  
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [isRendererReady, setIsRendererReady] = useState(false);
  
  // State for 3D Zoom
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [parallaxStrength, setParallaxStrength] = useState(0.05);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [depthDimensions, setDepthDimensions] = useState({ width: 1, height: 1 });
  
  const loadModel = async () => {
    if (depthEstimator) return;
    try {
      setStatus('Loading AI model...');
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
    setStatus('Analyzing image...');
    try {
        const result = await depthEstimator(imageUrl);
        const { data, dims } = result.predicted_depth;
        const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
        setDepthDimensions({ width, height });
        
        let min = Infinity, max = -Infinity, minIndex = 0;
        data.forEach((v: number, i: number) => {
            if (v < min) { min = v; minIndex = i; }
            if (v > max) max = v;
        });
        
        const farthestY = Math.floor(minIndex / width);
        const farthestX = minIndex % width;
        setFarthestPoint({ x: farthestX / width, y: farthestY / height });

        const range = max - min;
        const normalizedData = new Float32Array(data.length);
        for (let i = 0; i < data.length; ++i) {
            normalizedData[i] = (data[i] - min) / range;
        }
        
        rendererRef.current.updateDepthMap(normalizedData, width, height);
        setStatus('Ready.');
    } catch (e: any) {
        console.error("Error during analysis:", e);
        setStatus(`Failed to analyze image: ${e.message}`);
    }
  }, [depthEstimator]);

  const handleNewImage = useCallback(async () => {
    if (!rendererRef.current) return;
    setStatus('Loading random image...');
    const newImageUrl = await rendererRef.current.loadRandomImage();
    if (newImageUrl) {
        const dims = rendererRef.current.getImageDimensions();
        if (dims) setImageDimensions(dims);
        rendererRef.current.handleResize();
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

  return (
    <div id="app-container">
      <h1>WebGPU Depth Effects (Zoom Only)</h1>
      <p><strong>Status:</strong> {status}</p>
        <div className="controls">
            <button onClick={loadModel} disabled={!!depthEstimator}>
                {depthEstimator ? 'AI Model Loaded' : 'Load AI Model'}
            </button>
            <button onClick={handleNewImage} disabled={!isRendererReady}>
                Load New Random Image
            </button>
        </div>
      <WebGPUCanvas
        rendererRef={rendererRef}
        mode={mode}
        onRendererReady={() => setIsRendererReady(true)}
        farthestPoint={farthestPoint}
        imageDimensions={imageDimensions}
        depthDimensions={depthDimensions}
        parallaxStrength={parallaxStrength}
      />
    </div>
  );
}

export default App;
