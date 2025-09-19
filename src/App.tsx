import React, { useState, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

// Import the Transformers.js pipeline function
import { pipeline } from '@xenova/transformers';

function App() {
    const [mode, setMode] = useState<RenderMode>('depth'); // Default to our new mode
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [imageVersion, setImageVersion] = useState(0);
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg'); // Start with a default image
    
    // State to hold the depth estimator pipeline and the resulting depth map
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMap, setDepthMap] = useState<any>(null);
    const [status, setStatus] = useState('Loading Model...');

    // Load the AI model when the component mounts
    useEffect(() => {
        const loadModel = async () => {
            const estimator = await pipeline('depth-estimation', 'Xenova/depth-anything-base-hf', {device: 'webgpu' });
            setDepthEstimator(estimator);
            setStatus('Model Loaded. Click "New Random Image" to start.');
        };
        loadModel();
    }, []);

    // Function to run depth estimation on an image URL
    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        const result = await depthEstimator(url);
        setDepthMap(result);
        setStatus('Ready');
    }, [depthEstimator]);

    const handleNewImage = () => {
        setImageVersion(v => v + 1);
        // For now, let's just use the default image for simplicity.
        // We can add the random image logic back later.
        runDepthEstimation(imageUrl);
    };

    return (
        <div id="app-container">
            <h1>React, WebGPU & Transformers.js</h1>
            <p>{status}</p>
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onNewImage={handleNewImage}
                autoChangeEnabled={false} // Disabled for simplicity
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
                imageUrl={imageUrl} // Pass the image URL to the canvas
                depthMap={depthMap}   // Pass the depth map to the canvas
            />
        </div>
    );
}

export default App;
