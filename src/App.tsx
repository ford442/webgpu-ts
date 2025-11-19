import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { pipeline, env } from '@xenova/transformers';
import './style.css';
import StreetView from './components/StreetView';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.backends.onnx.wasm.numThreads = 1; // reduce threads to lower WASM memory usage
// Force CPU backend if WASM/WebGPU causes allocation failures
env.backends.onnx.executionProviders = ['cpu'];
env.backends.onnx.logLevel = 'warning';
const model_loc = 'Xenova/dpt-hybrid-midas'

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
  const [farthestPoint, setFarthestPoint] = useState({ x: 0.5, y: 0.5 });
  const [mousePosition, setMousePosition] = useState({ x: -1, y: -1 });
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [isAudioRunning, setIsAudioRunning] = useState(false);
  const [audioUrl, setAudioUrl] = useState('https://stream.zeno.fm/ywcmn7hpha0uv');

  // Stained-glass tunables
  const [cellSize, setCellSize] = useState(0.035);
  const [edgeWidth, setEdgeWidth] = useState(0.06);
  const [refraction, setRefraction] = useState(0.02);
  const [colorStrength, setColorStrength] = useState(1.0);
  const [zoomPreset, setZoomPreset] = useState(1);

  const rendererRef = useRef<Renderer | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
  const apiKey = 'AIzaSyABKwxIeRZX7VcFIejGkpSplxST_E0-Xn0'; // Replace with your actual API key

  const loadModel = async () => {
        if (depthEstimator) { setStatus('Model already loaded.'); return; }
        try {
            setStatus('Loading model...');

            // Shared timeout helper
            const withTimeout = (p: Promise<any>, ms = 120000) => {
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Model loading timeout (exceeded ' + ms/1000 + 's)')), ms));
                return Promise.race([p, timeout]);
            };

            const makePipelinePromise = (opts: any) => pipeline('depth-estimation', model_loc, opts);

            // Try 1: quantized model on current backend (we've set CPU by default to reduce WASM memory pressure)
            try {
                setStatus('Loading quantized model (preferred for low-memory environments)...');
                const estimator = await withTimeout(makePipelinePromise({
                    progress_callback: (progress: any) => {
                        if (progress.status === 'progress' && typeof progress.progress === 'number') {
                            setStatus(`Loading quantized model... ${progress.progress.toFixed(2)}%`);
                        } else if (progress.status) {
                            setStatus(`Loading quantized model... ${progress.status}`);
                        }
                    },
                    quantized: true,
                }));
                setDepthEstimator(() => estimator);
                setStatus('Quantized model loaded. Processing initial image...');
                return;
            } catch (quantErr: any) {
                console.warn('Quantized model load failed:', quantErr);
                // If quantized failed due to session/allocation, fall back to FP32 attempt below
                setStatus('Quantized model failed to load; attempting full model as fallback...');
            }

            // Try 2: full FP32 model (might be large)
            try {
                setStatus('Loading full (FP32) model — this may use more memory...');
                const estimator = await withTimeout(makePipelinePromise({
                    progress_callback: (progress: any) => {
                        if (progress.status === 'progress' && typeof progress.progress === 'number') {
                            setStatus(`Loading model... ${progress.progress.toFixed(2)}%`);
                        } else if (progress.status) {
                            setStatus(`Loading model... ${progress.status}`);
                        }
                    },
                    quantized: false,
                }));
                setDepthEstimator(() => estimator);
                setStatus('Model Loaded. Processing initial image...');
                return;
            } catch (primaryErr: any) {
                console.warn('Primary (FP32) model load failed:', primaryErr);
                const msg = (primaryErr && primaryErr.message) ? primaryErr.message : String(primaryErr);

                // If failure looks like an allocation/session problem, attempt smaller/quantized model on CPU explicitly
                if (/array buffer|allocation|out of memory|can'?t create a session|session/i.test(msg)) {
                    setStatus('FP32 model failed to initialize (likely memory). Will try CPU-quantized as a last resort...');
                } else {
                    // Non-memory error; rethrow for outer handler
                    throw primaryErr;
                }
            }

            // Try 3: force CPU backend and quantized model (last resort)
            try {
                // Temporarily switch ONNX to CPU execution provider
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    env.backends.onnx.executionProviders = ['cpu'];
                    setStatus('Switched to CPU backend. This may be slower but uses less GPU/WASM memory. Loading quantized model...');
                } catch (e) {
                    console.warn('Could not set executionProviders:', e);
                }

                const estimator = await withTimeout(makePipelinePromise({
                    progress_callback: (progress: any) => {
                        if (progress.status === 'progress' && typeof progress.progress === 'number') {
                            setStatus(`Loading CPU quantized model... ${progress.progress.toFixed(2)}%`);
                        } else if (progress.status) {
                            setStatus(`Loading CPU quantized model... ${progress.status}`);
                        }
                    },
                    quantized: true,
                }), 180000); // give CPU a bit more time

                setDepthEstimator(() => estimator);
                setStatus('Model loaded on CPU backend. Processing initial image...');
                return;
            } catch (cpuErr: any) {
                console.error('CPU backend model load failed:', cpuErr);
                throw cpuErr;
            }

        } catch (e: any) {
            console.error('Model loading error (final):', e);
            const errorMsg = e?.message || String(e);
            setStatus(`Failed to load model: ${errorMsg}. Consider enabling a smaller model, using a different browser, or increasing available memory.`);
        }
    };

  const runDepthAnalysis = useCallback(async (imageUrl: string) => {
      if (!depthEstimator || !rendererRef.current) return;
      setStatus('Analyzing image with AI model...');
      try {
          // Try multiple target sizes to reduce memory pressure and handle 'offset out of bounds' errors
          const sizes = [512, 384, 256, 160, 128];

          const resizeImageToDataUrl = async (url: string, maxDim: number): Promise<string> => {
              return new Promise<string>((resolve, reject) => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  img.onload = () => {
                      const w = img.naturalWidth;
                      const h = img.naturalHeight;
                      let tw = w;
                      let th = h;
                      if (Math.max(w, h) > maxDim) {
                          if (w >= h) {
                              tw = maxDim;
                              th = Math.round(h * (maxDim / w));
                          } else {
                              th = maxDim;
                              tw = Math.round(w * (maxDim / h));
                          }
                      }
                      const c = document.createElement('canvas');
                      c.width = tw;
                      c.height = th;
                      const ctx = c.getContext('2d');
                      if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
                      ctx.drawImage(img, 0, 0, tw, th);
                      try {
                          const dataUrl = c.toDataURL('image/jpeg', 0.85);
                          resolve(dataUrl);
                      } catch (e) {
                          reject(e);
                      }
                  };
                  img.onerror = (ev) => reject(new Error('Failed to load image for resizing'));
                  img.src = url;
              });
          };

          let result: any = null;
          let usedSize = -1;
          let lastError: any = null;

          for (const s of sizes) {
              try {
                  setStatus(`Analyzing image at ${s}px...`);
                  const inputForModel = await resizeImageToDataUrl(imageUrl, s);
                  // run inference; some runtimes will throw allocation/offset errors here
                  result = await depthEstimator(inputForModel);
                  usedSize = s;
                  break; // success
              } catch (err: any) {
                  lastError = err;
                  const msg = (err && err.message) ? err.message.toLowerCase() : String(err).toLowerCase();
                  console.warn(`Inference failed at size ${s}:`, err);
                  // If the error indicates buffer/session problems, try next smaller size
                  if (/offset is out of bounds|array buffer|allocation|out of memory|session|cannot create/i.test(msg)) {
                      setStatus(`Inference failed at ${s}px (${msg.split('\n')[0]}). Retrying smaller size...`);
                      // continue loop to try smaller size
                      continue;
                  } else {
                      // Non-memory-related error: rethrow
                      throw err;
                  }
              }
          }

          if (!result) {
              // All sizes failed
              const errorMsg = lastError?.message || String(lastError) || 'unknown error';
              throw new Error(`Depth inference failed at all sizes: ${errorMsg}`);
          }

          const { data, dims } = result.predicted_depth;
          const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];

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

          const range = max - min || 1.0;
          const normalizedData = new Float32Array(data.length);

          for (let i = 0; i < data.length; ++i) {
              normalizedData[i] = 1.0 - ((data[i] - min) / range);
          }

          setStatus(`Updating depth map on GPU... (inference size: ${usedSize}px)`);
          rendererRef.current.updateDepthMap(normalizedData, width, height);

          setDepthMapResult(result);
          setStatus('Ready.');
      } catch (e: any) {
          console.error("Error during analysis:", e);
          const em = e?.message || String(e);
          setStatus(`Failed to analyze image: ${em}. Try reducing image size or use a different machine.`);
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
              setFarthestPoint({ x: 0.5, y: 0.5 });
              setStatus('Ready. Load AI model to add depth effects.');
          }
      } else {
          setStatus('Failed to load a random image.');
      }
  }, [depthEstimator, runDepthAnalysis]);

  const startAudio = useCallback(async () => {
      if (!rendererRef.current) { setStatus('Renderer not ready; cannot start audio.'); return; }
      try {
          setStatus('Initializing audio stream...');
          const ok = await rendererRef.current.initAudio(audioUrl);
          if (!ok) { setStatus('Failed to initialize audio analyzer. See console for details.'); return; }
          await rendererRef.current.startAudio();
          setIsAudioRunning(true);
          setStatus('Audio started.');
      } catch (e:any) {
          console.error('Failed to start audio:', e);
          setStatus('Failed to start audio. Check console for details.');
      }
  }, [audioUrl]);

  const stopAudio = useCallback(() => {
      if (!rendererRef.current) { setStatus('Renderer not ready.'); return; }
      try {
          rendererRef.current.stopAudio();
          setIsAudioRunning(false);
          setStatus('Audio stopped.');
      } catch (e:any) {
          console.error('Failed to stop audio:', e);
          setStatus('Failed to stop audio.');
      }
  }, []);

  // Handler for StreetView canvas
  const handleStreetViewCanvas = useCallback((canvas: HTMLCanvasElement) => {
    setStreetViewCanvas(canvas);
  }, []);

  useEffect(() => {
      let intervalId: NodeJS.Timeout | null = null;
      if (autoChangeEnabled) {
          intervalId = setInterval(handleNewImage, autoChangeDelay * 1000);
      }
      return () => { if (intervalId) clearInterval(intervalId); };
  }, [autoChangeEnabled, autoChangeDelay, handleNewImage]);

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

  useEffect(() => {
      if (rendererRef.current) {
          rendererRef.current.setStainedParams(cellSize, edgeWidth, refraction, colorStrength);
         if (rendererRef.current.setZoomPreset) rendererRef.current.setZoomPreset(zoomPreset);
      }
  }, [cellSize, edgeWidth, refraction, colorStrength, zoomPreset]);

  return (
    <div id="app-container">
        <h1>WebGPU Liquid + Depth Effect</h1>
        <p><strong>Status:</strong> {status}</p>
        <StreetView onCanvasReady={handleStreetViewCanvas} apiKey={apiKey} />
        <Controls
            mode={mode}
            setMode={setMode}
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
            cellSize={cellSize}
            setCellSize={setCellSize}
            edgeWidth={edgeWidth}
            setEdgeWidth={setEdgeWidth}
            refraction={refraction}
            setRefraction={setRefraction}
            colorStrength={colorStrength}
            setColorStrength={setColorStrength}
            zoomPreset={zoomPreset}
            setZoomPreset={setZoomPreset}
            audioUrl={audioUrl}
            setAudioUrl={setAudioUrl}
            startAudio={startAudio}
            stopAudio={stopAudio}
            audioRunning={isAudioRunning}
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
            source={streetViewCanvas}
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
