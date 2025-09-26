import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import './style.css';
import { pipeline } from '@xenova/transformers';

function App() {
    const [status, setStatus] = useState('Click "Load Model" to start.');
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMapResult, setDepthMapResult] = useState<any>(null);
    const debugCanvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<any>(null);
    
    const [parallaxStrength, setParallaxStrength] = useState(0.05);
    const [numSteps, setNumSteps] = useState(32);
    const [occlusionStrength, setOcclusionStrength] = useState(0.3);
    const [ambientLight, setAmbientLight] = useState(0.3);
    
    useEffect(() => {
        rendererRef.current?.updateParams({
            strength: parallaxStrength, 
            layers: numSteps,
            occlusion: occlusionStrength, 
            ambient: ambientLight
        });
    }, [parallaxStrength, numSteps, occlusionStrength, ambientLight]);

    useEffect(() => {
        if (depthMapResult?.predicted_depth && debugCanvasRef.current) {
            const { data, dims } = depthMapResult.predicted_depth;
            const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];
            const canvas = debugCanvasRef.current;
            const context = canvas.getContext('2d');
            if (!width || !height || !context) return;
            
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
            canvas.width = width; 
            canvas.height = height;
            context.putImageData(imageData, 0, 0);
        }
    }, [depthMapResult]);

    const loadModel = async () => {
        if (depthEstimator) { setStatus('Model already loaded.'); return; }
        try {
            setStatus('Loading model...');
            const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas');
            setDepthEstimator(() => estimator);
            setStatus('Model Loaded. Processing initial image...');
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load model: ${e.message}`);
        }
    };

     const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        try {
            const result = await depthEstimator(url);
            
            // --- START: Robust Normalization Fix ---
            const rawDepth = result.predicted_depth.data as Float32Array;
            let minDepth = Infinity;
            let maxDepth = -Infinity;

            // Step 1: Find the min and max, but ignore any non-finite numbers.
            for (let i = 0; i < rawDepth.length; i++) {
                const val = rawDepth[i];
                if (isFinite(val)) { // This check prevents NaN/Infinity from breaking our range.
                    if (val < minDepth) minDepth = val;
                    if (val > maxDepth) maxDepth = val;
                }
            }
            
            // Step 2: Handle the edge case where the model output is entirely invalid.
            if (!isFinite(minDepth)) {
                console.error("Depth estimation resulted in non-finite data. Using a flat map as a fallback.");
                // Create a completely flat depth map if all data was bad.
                const flatDepth = new Float32Array(rawDepth.length).fill(0.5);
                setDepthMap({
                    predicted_depth: {
                        data: flatDepth,
                        width: result.predicted_depth.width,
                        height: result.predicted_depth.height,
                    }
                });
                setStatus('Ready (using fallback depth)');
                return; // Exit the function early.
            }

            const normalizedDepth = new Float32Array(rawDepth.length);
            const range = maxDepth - minDepth;

            // Step 3: Normalize the data, replacing any bad values with a neutral middle-ground depth.
            for (let i = 0; i < rawDepth.length; i++) {
                const val = rawDepth[i];
                if (isFinite(val) && range > 0) {
                    // If the value is valid, normalize it as before.
                    normalizedDepth[i] = 1.0 - (val - minDepth) / range;
                } else {
                    // If the value is NaN, Infinity, or range is 0, use a safe default.
                    normalizedDepth[i] = 0.5; 
                }
            }

            const normalizedResult = {
                predicted_depth: {
                    data: normalizedDepth,
                    width: result.predicted_depth.width,
                    height: result.predicted_depth.height
                }
            };
            
            setDepthMap(normalizedResult);
            // --- END: Robust Normalization Fix ---

            setStatus('Ready');
        } catch (e) {
            console.error(e);
            setStatus('Failed to analyze image.');
        }
    }, [depthEstimator]);

    const handleAnalyzeUrl = useCallback(async (url: string) => {
        if (!rendererRef.current || !url || !depthEstimator) {
            setStatus("Please load the model first and enter a URL.");
            return;
        }
        setStatus('Loading image from URL...');
        await rendererRef.current.loadImage(url);
        await runDepthAnalysis(url);
    }, [runDepthAnalysis, depthEstimator]);

    const handleLoadRandom = useCallback(async () => {
        if (!rendererRef.current || !depthEstimator) {
            setStatus("Please load the model first.");
            return;
        }
        setStatus('Loading random image...');
        const newImageUrl = await rendererRef.current.loadRandomImage();
        if (newImageUrl) {
            setImageUrl(newImageUrl);
            await runDepthAnalysis(newImageUrl);
        } else {
            setStatus('Failed to load a random image.');
        }
    }, [runDepthAnalysis, depthEstimator]);

    useEffect(() => {
        if (depthEstimator) {
            handleAnalyzeUrl(imageUrl);
        }
    }, [depthEstimator, handleAnalyzeUrl]);

    return (
        <div id="app-container">
            <h1>WebGPU Viewer: Self-Shadowing Parallax</h1>
            <p><strong>Status:</strong> {status}</p>
            <Controls
                imageUrl={imageUrl}
                setImageUrl={setImageUrl}
                onLoadModel={loadModel}
                onAnalyze={() => handleAnalyzeUrl(imageUrl)}
                onLoadRandom={handleLoadRandom}
                parallaxStrength={parallaxStrength}
                setParallaxStrength={setParallaxStrength}
                occlusionStrength={occlusionStrength}
                setOcclusionStrength={setOcclusionStrength}
                numSteps={numSteps}
                setNumSteps={setNumSteps}
                ambientLight={ambientLight}
                setAmbientLight={setAmbientLight}
            />
            <WebGPUCanvas rendererRef={rendererRef} />
            {depthMapResult && (
                <div style={{ marginTop: '20px' }}>
                    <h2>AI Model Output (Debug Depth Map)</h2>
                    <canvas ref={debugCanvasRef} style={{ border: '1px solid grey', maxWidth: '100%', height: 'auto' }} />
                </div>
            )}
        </div>
    );
}

export default App;
