import React, { useState, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

import { pipeline } from '@xenova/transformers';

function App() {
    const [mode, setMode] = useState<RenderMode>('depth');
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [imageVersion, setImageVersion] = useState(0);
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMap, setDepthMap] = useState<any>(null);
    const [status, setStatus] = useState('Loading Model...');

    // Load the AI model
    useEffect(() => {
        const loadModel = async () => {
            try {
                // Using a known-good, high-quality depth model
                const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas', {
                    progress_callback: (progress: any) => {
                        setStatus(`Loading Model: ${progress.file} (${Math.round(progress.progress)}%)`);
                    }
                });
                setDepthEstimator(estimator);
                setStatus('Model Loaded. Click "New Random Image" to start.');
            } catch (e) {
                console.error(e);
                setStatus('Failed to load AI model.');
            }
        };
        loadModel();
    }, []);

    // Function to run depth estimation
    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        try {
            const result = await depthEstimator(url);
            
            // --- START: Normalization Fix ---
            const rawDepth = result.predicted_depth.data;
            let minDepth = Infinity;
            let maxDepth = -Infinity;

            // Find the min and max depth values in the raw data
            for (let i = 0; i < rawDepth.length; i++) {
                if (rawDepth[i] < minDepth) minDepth = rawDepth[i];
                if (rawDepth[i] > maxDepth) maxDepth = rawDepth[i];
            }

            // Create a new array to hold the normalized values
            const normalizedDepth = new Float32Array(rawDepth.length);
            const range = maxDepth - minDepth;

            // Normalize the data to a 0.0 - 1.0 range (and invert it)
            for (let i = 0; i < rawDepth.length; i++) {
                // Inverting the normalization: 1.0 - ...
                // This makes closer objects have higher values (e.g., 1.0) 
                // and farther objects have lower values (e.g., 0.0),
                // which is standard for parallax effects.
                if (range > 0) {
                    normalizedDepth[i] = 1.0 - (rawDepth[i] - minDepth) / range;
                } else {
                    normalizedDepth[i] = 0.0; // Handle case where all depths are the same
                }
            }

            // Create a new object to store with the normalized data
            const normalizedResult = {
                predicted_depth: {
                    data: normalizedDepth,
                    width: result.predicted_depth.width,
                    height: result.predicted_depth.height
                }
            };
            
            setDepthMap(normalizedResult);
            // --- END: Normalization Fix ---

            setStatus('Ready');
        } catch (e) {
            console.error(e);
            setStatus('Failed to analyze image.');
        }
    }, [depthEstimator]);

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
