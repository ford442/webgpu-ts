import React, { useState } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

function App() {
    const [mode, setMode] = useState<RenderMode>('shader');
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [videoSrc1, setVideoSrc1] = useState<string>('');
    const [videoSrc2, setVideoSrc2] = useState<string>('');

    const handleVideo1Change = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const url = URL.createObjectURL(event.target.files[0]);
            setVideoSrc1(url);
        }
    };

    const handleVideo2Change = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            const url = URL.createObjectURL(event.target.files[0]);
            setVideoSrc2(url);
        }
    };

    return (
        <div id="app-container">
            <h1>React & WebGPU Renderer</h1>
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onVideo1Change={handleVideo1Change}
                onVideo2Change={handleVideo2Change}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                videoSrc1={videoSrc1}
                videoSrc2={videoSrc2}
            />
        </div>
    );
}

export default App;
