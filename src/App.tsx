import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline } from '@huggingface/transformers';
import './style.css';

function App() {
  const [mode, setMode] = useState<RenderMode>('ambient-liquid');
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);
  const [isRendererReady, setIsRendererReady] = useState(false);
  
  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  // State for 3D Zoom
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [parallaxStrength, setParallaxStrength] = useState(0.05);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [depthDimensions, setDepthDimensions] = useState({ width: 1, height: 1 });
  
  const loadModel = async () => {
    if (depthEstimator) return;
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
    if (!rendererRef.current) return;
    setStatus('Loading random image...');
    const newImageUrl = await rendererRef.current.loadRandomImage();
    if (newImageUrl) {
        const dims = rendererRef.current.getImageDimensions();
        setImageDimensions(dims);
        rendererRef.current.handleResize();
        if (depthEstimator) {
            await runDepthAnalysis(newImageUrl);
        } else {
            setStatus('Ready. Load AI model to add depth effects.');
        }
    } else {
        setStatus('Failed to load a random image.');
    }
  }, [depthEstimator, runDepthAnalysis]);

  // --- ADD THIS WHOLE useEffect HOOK ---
  // This hook runs once after the renderer initializes to set up the FIRST image.
  useEffect(() => {
    if (isRendererReady && rendererRef.current) {
        const setupInitialImage = async () => {
            const renderer = rendererRef.current!;
            // Get dimensions of the initially loaded image
            const dims = renderer.getImageDimensions();
            setImageDimensions(dims);
            // Trigger the first resize
            renderer.handleResize();
            
            // If the model is already loaded, analyze the initial image
            if (depthEstimator) {
                const initialUrl = renderer.getCurrentImageUrl();
                if (initialUrl) {
                    await runDepthAnalysis(initialUrl);
                }
            }
        };
        setupInitialImage();
    }
  }, [isRendererReady, depthEstimator, runDepthAnalysis]);

  useEffect(() => {
    if (depthMapResult?.predicted_depth && debugCanvasRef.current) {
      const { data, dims } = depthMapResult.predicted_depth;
      const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
      const canvas = debugCanvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = width;
      canvas.height = height;
      const imageData = context.createImageData(width, height);
      let min = Infinity, max = -Infinity;
      data.forEach((v: number) => { if (v < min) min = v; if (v > max) max = v; });
      const range = max - min;
      for (let i = 0; i < data.length; ++i) {
        const value = Math.round(((data[i] - min) / range) * 255);
        imageData.data.set([value, value, value, 255], i * 4);
      }
      context.putImageData(imageData, 0, 0);
    }
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
        isRendererReady={isRendererReady}
        parallaxStrength={parallaxStrength} setParallaxStrength={setParallaxStrength}
      />
      <div style={{ width: '90vw', height: '80vh', maxWidth: '1600px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <WebGPUCanvas
          rendererRef={rendererRef}
          mode={mode}
          onRendererReady={() => setIsRendererReady(true)}
          params={{
            farthestPoint,
            imageDimensions,
            depthDimensions,
            parallaxStrength,
          }}
        />
      </div>
      {depthMapResult && (
           <div className="debug-container" style={{ marginTop: '20px' }}>
          <h2>AI Model Output (Debug Depth Map)</h2>
          <canvas ref={debugCanvasRef} style={{ maxWidth: '1280px', height: '1280px', border: '1px solid grey' }} />
        </div>
      )}
    </div>
  );
}

export default App;
