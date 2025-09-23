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
    
    // State for the URL input field
    const [imageUrl, setImageUrl] = useState('https://i.imgur.com/vCNL2sT.jpeg');
    // State for the image that should be rendered in the canvas
    const [imageToRender, setImageToRender] = useState('');

    const [depthEstimator, setDepthEstimator] = useState<any>(null);
    const [depthMap, setDepthMap] = useState<any>(null);
    const [status, setStatus] = useState('Loading Model...');
    
    const debugCanvasRef = useRef<HTMLCanvasElement>(null);

    // Load the AI model (no changes here)
    useEffect(() => {
        const loadModel = async () => {
            try {
                const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas');
                setDepthEstimator(estimator);
                setStatus('Model Loaded. Click "New Random Image" to start.');
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
    
    // Draw the depth map to the debug canvas (no changes here)
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

    // This is the core function for processing the image
    const processNewImage = useCallback(async (url: string) => {
        if (!depthEstimator) {
            setStatus("Model not ready yet.");
            return;
        }
        if (!url) {
            setStatus("Please enter an image URL.");
            return;
        }

        setStatus('Analyzing Image...');
        try {
            // Let the pipeline handle the fetching and analysis.
            const result = await depthEstimator(url);

            // --- SEQUENTIAL LOGIC ---
            // ONLY after the analysis is successful, update the state for the renderer.
            setDepthMap(result);
            setImageToRender(url); // This will trigger the canvas to update.
            setStatus('Ready');

        } catch (e) {
            console.error("Error during depth estimation:", e);
            if (e instanceof Error) {
                setStatus(`Failed to analyze image: ${e.message}`);
            } else {
                setStatus('Failed to analyze image due to an unknown error.');
            }
        }
    }, [depthEstimator]);

    // The button click handler now calls our main processing function.
    const handleNewImageClick = () => {
        processNewImage(imageUrl);
    };

    return (
        <div id="app-container">
            <h1>React, WebGPU & Transformers.js</h1>
            <p><strong>Status:</strong> {status}</p>
            
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
                onNewImage={handleNewImageClick}
                autoChangeEnabled={false}
                setAutoChangeEnabled={() => {}}
                autoChangeDelay={5}
                setAutoChangeDelay={() => {}}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom} panX={panX} panY={panY}
                imageUrl={imageToRender} // Pass the new state variable here
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
