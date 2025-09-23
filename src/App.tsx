import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';
import { pipeline, RawImage } from '@xenova/transformers';

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
            setStatus('Model Loaded. Analyze an image.');
        } catch (e: any) {
            console.error(e);
            setStatus(`Failed to load model: ${e.message}`);
        }
    };

    const processNewImage = useCallback(async (url: string) => {
        if (!depthEstimator) { setStatus("Please load the model first."); return; }
        if (!rendererRef.current) { setStatus("Renderer not ready."); return; }
        if (!url) { setStatus("Please enter an image URL."); return; }

        setStatus('Analyzing Image...');
        try {
            const result = await depthEstimator(url);
            const { data, dims } = result.predicted_depth;
            const [height, width] = [dims[dims.length - 2], dims[dims.length - 1]];

            setStatus('Loading image & depth map to GPU...');
            await rendererRef.current.loadImage(url);
            rendererRef.current.updateDepthMap(data, width, height);
            rendererRef.current.createBindGroups();
            
            if (!rendererRef.current.isReady) {
                throw new Error("Bind group creation failed.");
            }

            setDepthMapResult(result);
            setStatus('Ready. Move mouse over the image.');
        } catch (e: any) {
            console.error("Error during processing:", e);
            setStatus(`Failed to process image: ${e.message}`);
        }
    }, [depthEstimator]);

    return (
        <div id="app-container">
            <h1>WebGPU Viewer: Self-Shadowing Parallax</h1>
            <p><strong>Status:</strong> {status}</p>
            <Controls
                imageUrl={imageUrl}
                setImageUrl={setImageUrl}
                onLoadModel={loadModel}
                onAnalyze={processNewImage}
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
