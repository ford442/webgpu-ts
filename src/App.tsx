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
  const [isRendererReady, setIsRendererReady] = useState(false);
  
  // --- CONSOLIDATED STATE & REFS ---
  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

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
  const [pointSize, setPointSize] = useState(1.0);
    
  // This useEffect correctly updates the parallax params when they change
  useEffect(() => {
    rendererRef.current?.updateParallaxParams({
        displacementScale, ambient: ambientLight, smoothness, pointSize
    });
  }, [displacementScale, ambientLight, smoothness, pointSize]);

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

  const findOptimalThreshold = (data: Float32Array): number => {
    const binCount = 256;
    const histogram = new Array(binCount).fill(0);
    for (let i = 0; i < data.length; ++i) {
        const bin = Math.min(Math.floor(data[i] * binCount), binCount - 1);
        histogram[bin]++;
    }
    const totalPixels = data.length;
    let bestThreshold = 0, maxVariance = 0, sum = 0;
    for (let i = 0; i < binCount; i++) sum += i * histogram[i];
    let sumB = 0, wB = 0, wF = 0;
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

        const newThreshold = findOptimalThreshold(normalizedData);
        setDepthThreshold(newThreshold);

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
      data.forEach((v: number) => { if (v < min) min = v; if (v > max) max = v; });
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
      <h1>WebGPU Depth Effects</h1>
      <p><strong>Status:</strong> {status}</p>
      <Controls
        mode={mode} setMode={setMode}
        onNewImage={handleNewImage}
        onLoadModel={loadModel}
        isModelLoaded={!!depthEstimator}
        isRendererReady={isRendererReady}
        // Props for 3D Zoom
        // depthThreshold={depthThreshold} setDepthThreshold={setDepthThreshold}
        // edgeHardness={edgeHardness} setEdgeHardness={setEdgeHardness}
        // depthLevels={depthLevels} setDepthLevels={setDepthLevels}
        // fogColor={fogColor} setFogColor={setFogColor}
        // fogDensity={fogDensity} setFogDensity={setFogDensity}
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
        onRendererReady={() => setIsRendererReady(true)}
        // Props for 3D Zoom
        farthestPoint={farthestPoint}
        // depthThreshold={depthThreshold}
        // edgeHardness={edgeHardness}
        // depthLevels={depthLevels}
        imageDimensions={imageDimensions}
        depthDimensions={depthDimensions}
        // fogColor={fogColor}
        // fogDensity={fogDensity}
        parallaxStrength={parallaxStrength}
      />
      {depthMapResult && (
           <div className="debug-container">
          <h2>AI Model Output (Debug Depth Map)</h2>
          <canvas ref={debugCanvasRef} style={{ maxWidth: '1280px', height: '1280px', border: '1px solid grey' }} />
        </div>
      )}
    </div>
  );
}

export default App;
