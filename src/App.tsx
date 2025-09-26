import React, { useState, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

import { pipeline } from '@xenova/transformers';

// Define a clear type for our depth map data for better type safety.
interface DepthMapData {
    predicted_depth: {
        data: Float32Array;
        width: number;
        height: number;
    }
}

function App() {
    const [mode, setMode] = useState<RenderMode>('depth');
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [imageVersion, setImageVersion] = useState(0);
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    // Use our new interface for the state, allowing it to be DepthMapData or null.
    const [depthMap, setDepthMap] = useState<DepthMapData | null>(null);
    const [status, setStatus] = useState('Loading Model...');

    // Load the AI model
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

    // Function to run depth estimation with robust error handling.
    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        try {
            const result = await depthEstimator(url);
            
            const rawDepth = result.predicted_depth.data as Float32Array;
            let minDepth = Infinity;
            let maxDepth = -Infinity;

            for (let i = 0; i < rawDepth.length; i++) {
                const val = rawDepth[i];
                if (isFinite(val)) {
                    if (val < minDepth) minDepth = val;
                    if (val > maxDepth) maxDepth = val;
                }
            }
            
            if (!isFinite(minDepth)) {
                console.error("Depth estimation resulted in non-finite data. Using a flat map as a fallback.");
                const flatDepth = new Float32Array(rawDepth.length).fill(0.5);
                setDepthMap({ // This call should now compile correctly.
                    predicted_depth: {
                        data: flatDepth,
                        width: result.predicted_depth.width,
                        height: result.predicted_depth.height,
                    }
                });
                setStatus('Ready (using fallback depth)');
                return;
            }

            const normalizedDepth = new Float32Array(rawDepth.length);
            const range = maxDepth - minDepth;

            for (let i = 0; i < rawDepth.length; i++) {
                const val = rawDepth[i];
                if (isFinite(val) && range > 0) {
                    normalizedDepth[i] = 1.0 - (val - minDepth) / range;
                } else {
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
            setStatus('Ready');
        } catch (e) {
            console.error(e);
            setStatus('Failed to analyze image.');
        }
        // Added state setters to the dependency array for completeness.
    }, [depthEstimator, setStatus, setDepthMap]);

    const handleNewImage = () => {
        setImageVersion(v => v + 1);
        runDepthEstimation(imageUrl);
    };

    return (
        <div id="app-container">
            <h1>React, WebGPU & Transformers.js</h1>
            <p><strong>Status:</strong> {status}</p>
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onNewImage={handleNewImage}
                autoChangeEnabled={false}
                setAutoChangeEnabled={() => {}}
                autoChangeDelay={5}
                setAutoChangeDelay={() => {}}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageVersion={imageVersion}
                imageUrl={imageUrl}
                depthMap={depthMap}
            />
        </div>
    );
}

export default App;
