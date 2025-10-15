import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline, env } from '@huggingface/transformers';
import './style.css';

env.allowLocalModels = false;
env.backends.onnx.executionProviders = ['webgpu'];
env.backends.onnx.logLevel = 'warning';
const model_loc = 'Xenova/dpt-hybrid-midas'

function App() {
  const [mode, setMode] = useState<RenderMode>('3d-zoom');
  const [status, setStatus] = useState('Ready. Click "Load AI Model" for depth effects.');
  const [depthEstimator, setDepthEstimator] = useState<any>(null);
  const [depthMapResult, setDepthMapResult] = useState<any>(null);
  const [depthThreshold, setDepthThreshold] = useState(0.5);
  const [edgeHardness, setEdgeHardness] = useState(0.5);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [depthDimensions, setDepthDimensions] = useState({ width: 1, height: 1 }); // New state
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [depthLevels, setDepthLevels] = useState(5); // Start with 5 levels
  const [fogColor, setFogColor] = useState('#202025'); // Initial fog color (dark blue-gray)
  const [fogDensity, setFogDensity] = useState(3.0);
  const [parallaxStrength, setParallaxStrength] = useState(0.05);
  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  
   const loadModel = async () => {
        if (depthEstimator) { setStatus('Model already loaded.'); return; }
        try {
            setStatus('Loading model...');
            const estimator = await pipeline('depth-estimation', model_loc, {
                 progress_callback: (progress: any) => {
                    if (progress.status === 'progress' && typeof progress.progress === 'number') {
                        setStatus(`Loading model... ${progress.progress.toFixed(2)}%`);
                    } else {
                        setStatus(progress.status);
                    }
                },
            // quantized: false // Correct: Use this to load the FP32 model
            dtype: fp32 // Correct: Use this to load the FP32 model
            });
            setDepthEstimator(() => estimator);
            setStatus('Model Loaded. Processing initial image...');
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load model: ${e.message}`);
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
        if (!depthEstimator || !rendererRef.current) return;
        setStatus('Analyzing image with AI model...');
        try {
            const result = await depthEstimator(imageUrl);
            const { data, dims } = result.predicted_depth;
            const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
            setDepthDimensions({ width, height });
            let min = Infinity, max = -Infinity;
            let minIndex = 0;
            data.forEach((v: number, i: number) => {
                if (v < min) {
                    min = v;
                    minIndex = i;
                }
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
            console.log(`Optimal depth threshold found: ${newThreshold.toFixed(3)}`);
            setDepthThreshold(newThreshold); // Set the new threshold in the UI
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
        const dims = rendererRef.current.getImageDimensions();
        if (dims) {
            setImageDimensions(dims);
        }
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
        onNewImage={handleNewImage}
        onLoadModel={loadModel}
        isModelLoaded={!!depthEstimator}
        depthThreshold={depthThreshold}
        setDepthThreshold={setDepthThreshold}
        edgeHardness={edgeHardness}
        setEdgeHardness={setEdgeHardness}
        depthLevels={depthLevels}
        setDepthLevels={setDepthLevels}
        fogColor={fogColor}
        setFogColor={setFogColor}
        fogDensity={fogDensity}
        setFogDensity={setFogDensity}
        parallaxStrength={parallaxStrength}
        setParallaxStrength={setParallaxStrength}
      />
      <WebGPUCanvas
        rendererRef={rendererRef}
        mode={mode}
        farthestPoint={farthestPoint}
        depthThreshold={depthThreshold}
        edgeHardness={edgeHardness}
        imageDimensions={imageDimensions}
        depthDimensions={depthDimensions} // Pass the new prop
        depthLevels={depthLevels}
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
