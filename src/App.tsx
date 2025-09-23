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

    useEffect(() => {
        const loadModel = async () => {
            try {
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

    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        try {
            const result = await depthEstimator(url);
            setDepthMap(result);
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
