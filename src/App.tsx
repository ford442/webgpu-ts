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
    const [imageVersion, setImageVersion] = useState(0);

    const handleNewImage = () => {
        setImageVersion(v => v + 1);
    };

    return (
        <div id="app-container">
            <h1>React & WebGPU Renderer</h1>
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onNewImage={handleNewImage}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageVersion={imageVersion}
            />
        </div>
    );
}

export default App;
