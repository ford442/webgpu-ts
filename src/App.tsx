// src/App.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    
    // --- FIX for ESLint warning: We will now use setImageUrl ---
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    
    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMap, setDepthMap] = useState<any>(null);
    const [status, setStatus] = useState('Loading Model...');
    
    const debugCanvasRef = useRef<HTMLCanvasElement>(null);

    // Load the AI model
    useEffect(() => {
        const loadModel = async () => {
            try {
                const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas', {
                    progress_callback: (progress: any) => {
                        setStatus(`Loading Model: ${progress.file} (${Math.round(progress.progress)}%)`);
                    },
                    local_files_only: false,
                });
                setDepthEstimator(estimator);
                setStatus('Model Loaded. Enter an image URL and click "New Image".');
            } catch (e) {
                console.error(e);
                if (e instanceof Error) {
                    setStatus(`Failed to load AI model: ${e.message}. Check console for details.`);
                } else {
                    setStatus('Failed to load AI model due to an unknown error.');
                }
            }
        };
        loadModel();
    }, []);
    
    // useEffect to draw the depth map to the debug canvas... (no changes here)
    useEffect(() => {
        if (depthMap && debugCanvasRef.current) {
            const canvas = debugCanvasRef.current;
            const context = canvas.getContext('2d');
            if (!context) return;
            
            const { data, width, height } = depthMap.predicted_depth;
            const imageData = new ImageData(width, height);
            
            let min = data[0]; let max = data[0];
            for (let i = 1; i < data.length; ++i) {
                if (data[i] < min) min = data[i];
                if (data[i] > max) max = data[i];
            }
            const range = max - min;

            for (let i = 0; i < data.length; ++i) {
                const value = Math.round(((data[i] - min) / range) * 255);
                imageData.data[i * 4] = value; imageData.data[i * 4 + 1] = value;
                imageData.data[i * 4 + 2] = value; imageData.data[i * 4 + 3] = 255;
            }
            
            canvas.width = width; canvas.height = height;
            context.putImageData(imageData, 0, 0);
        }
    }, [depthMap]);

    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator || !url) return;
        setStatus('Analyzing Image...');
        try {
            // --- THIS IS THE FIX for the crash ---
            // Pass the URL string directly to the estimator.
            const result = await depthEstimator(url);
            setDepthMap(result);
            setStatus('Ready');
        } catch (e) {
            console.error(e);
            setStatus(`Failed to analyze image: ${e.message}`);
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
            
            {/* --- FIX for ESLint warning: Add an input to change the URL --- */}
            <div className="control-group" style={{ justifyContent: 'center', marginBottom: '15px' }}>
                <label htmlFor="image-url-input">Image URL:</label>
                <input 
                    type="text" 
                    id="image-url-input"
                    value={imageUrl} 
                    onChange={(e) => setImageUrl(e.target.value)}
                    style={{ width: '300px' }}
                />
            </div>
            
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
                zoom={zoom} panX={panX} panY={panY}
                imageVersion={imageVersion}
                imageUrl={imageUrl}
                depthMap={depthMap}
            />
            <div style={{ marginTop: '20px' }}>
                <h2>AI Model Output (Depth Map)</h2>
                <canvas ref={debugCanvasRef} style={{ border: '1px solid grey' }} />
            </div>
        </div>
    );
}

export default App;
