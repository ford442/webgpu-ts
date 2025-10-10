import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import './style.css';
import { pipeline, env } from '@xenova/transformers';

function App() {
    const [status, setStatus] = useState('Click "Load Model" to start.');
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMapResult, setDepthMapResult] = useState<any>(null);
    const debugCanvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<any>(null);
    
    const [displacementScale, setDisplacementScale] = useState(0.3);
    const [ambientLight, setAmbientLight] = useState(0.2);
    const [smoothness, setSmoothness] = useState(1.0);
    const [pointSize, setPointSize] = useState(1.0); // New state

env.allowLocalModels = false;
env.backends.onnx.executionProviders = ['webgpu'];
env.backends.onnx.logLevel = 'warning';
    
// const model_loc = 'https://test.1ink.us/webgputs/models/model.onnx'
const model_loc = 'Xenova/dpt-hybrid-midas'
    
    useEffect(() => {
        rendererRef.current?.updateParams({
            displacementScale: displacementScale, 
            ambient: ambientLight,
            smoothness: smoothness,
            pointSize: pointSize // Pass new param
        });
    }, [displacementScale, ambientLight, smoothness, pointSize]);

    useEffect(() => {
        if (depthMapResult?.predicted_depth && debugCanvasRef.current) {
            // This debug canvas logic is already correct, as it normalizes for display.
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
            const estimator = await pipeline('depth-estimation', model_loc, {
                 progress_callback: (progress: any) => {
                    if (progress.status === 'progress' && typeof progress.progress === 'number') {
                        setStatus(`Loading model... ${progress.progress.toFixed(2)}%`);
                    } else {
                        setStatus(progress.status);
                    }
                },
                dtype: 'fp32'
            });
            setDepthEstimator(() => estimator);
            setStatus('Model Loaded. Processing initial image...');
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load model: ${e.message}`);
        }
    };

    const runDepthAnalysis = useCallback(async (url: string) => {
        if (!depthEstimator || !rendererRef.current) return;
        setStatus('Analyzing Image with AI model...');
        try {
            const result = await depthEstimator(url);
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
                // Invert the depth map so closer objects are "higher" (value 1)
                normalizedData[i] = 1.0 - ((data[i] - min) / range);
            }

            setStatus('Updating depth map on GPU...');
            rendererRef.current.updateDepthMap(normalizedData, width, height);
            rendererRef.current.createBindGroups();
            
            if (!rendererRef.current.isReady) throw new Error("Bind group creation failed.");

            setDepthMapResult(result);
            setStatus('Ready. Move mouse over the image.');
        } catch (e: any) {
            console.error("Error during analysis:", e);
            setStatus(`Failed to analyze image: ${e.message}`);
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
            <h1>WebGPU Viewer: 3D Displacement Mapping</h1>
            <p><strong>Status:</strong> {status}</p>
            <Controls
                imageUrl={imageUrl}
                setImageUrl={setImageUrl}
                onLoadModel={loadModel}
                onAnalyze={() => handleAnalyzeUrl(imageUrl)}
                onLoadRandom={handleLoadRandom}
                displacementScale={displacementScale}
                setDisplacementScale={setDisplacementScale}
                ambientLight={ambientLight}
                setAmbientLight={setAmbientLight}
                smoothness={smoothness}
                setSmoothness={setSmoothness}
                pointSize={pointSize}
                setPointSize={setPointSize}
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
