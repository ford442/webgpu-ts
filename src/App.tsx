import React, { useState, useEffect, useCallback, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

import { pipeline, RawImage } from '@xenova/transformers';

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
    
    // --- FIX #2: Create a ref for our new debug canvas ---
    const debugCanvasRef = useRef<HTMLCanvasElement>(null);

    // Load the AI model
    useEffect(() => {
        const loadModel = async () => {
            try {
                // --- FIX #1: Force remote loading, ignore local models ---
                const estimator = await pipeline('depth-estimation', 'Xenova/dpt-hybrid-midas', {
                    progress_callback: (progress: any) => {
                        setStatus(`Loading Model: ${progress.file} (${Math.round(progress.progress)}%)`);
                    },
                    local_files_only: false, // Ensure it downloads from the hub
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
    
    // --- FIX #2: useEffect to draw the depth map to the debug canvas ---
    useEffect(() => {
        if (depthMap && debugCanvasRef.current) {
            const canvas = debugCanvasRef.current;
            const context = canvas.getContext('2d');
            if (!context) return;
            
            // The model returns a tensor; we need to convert it to a visual image.
            const { data, width, height } = depthMap.predicted_depth;
            const imageData = new ImageData(width, height);
            
            // Normalize the depth data to a 0-255 grayscale range
            let min = data[0];
            let max = data[0];
            for (let i = 1; i < data.length; ++i) {
                if (data[i] < min) min = data[i];
                if (data[i] > max) max = data[i];
            }
            const range = max - min;

            for (let i = 0; i < data.length; ++i) {
                const value = Math.round(((data[i] - min) / range) * 255);
                imageData.data[i * 4] = value;     // R
                imageData.data[i * 4 + 1] = value; // G
                imageData.data[i * 4 + 2] = value; // B
                imageData.data[i * 4 + 3] = 255;   // A
            }
            
            canvas.width = width;
            canvas.height = height;
            context.putImageData(imageData, 0, 0);
        }
    }, [depthMap]);

    const runDepthEstimation = useCallback(async (url: string) => {
        if (!depthEstimator) return;
        setStatus('Analyzing Image...');
        try {
            // Ensure the input is a URL string
            const image = await RawImage.fromURL(url);
            const result = await depthEstimator(image);
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
            {/* --- FIX #2: Add the debug canvas below the main one --- */}
            <div style={{ marginTop: '20px' }}>
                <h2>AI Model Output (Depth Map)</h2>
                <canvas ref={debugCanvasRef} style={{ border: '1px solid grey' }} />
            </div>
        </div>
    );
}

export default App;
