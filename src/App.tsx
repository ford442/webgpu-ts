import React, { useState, useEffect, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode, Renderer } from './renderer/Renderer';
import './style.css';

function App() {
    // Keep existing state
    const [mode, setMode] = useState<RenderMode>('image');
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [imageVersion, setImageVersion] = useState(0);
    const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
    const [autoChangeDelay, setAutoChangeDelay] = useState(5);

    // --- NEW STATE FOR THE EFFECT SYSTEM ---
    const rendererRef = useRef<Renderer | null>(null);
    const [availableEffects, setAvailableEffects] = useState<string[]>([]);
    const [activeEffect, setActiveEffect] = useState<string>('');

    // This useEffect hook is now responsible for initializing the renderer
    // and populating the list of available effects.
    useEffect(() => {
        // We pass the renderer instance up to the App component to control it
        if (rendererRef.current) {
            setAvailableEffects(rendererRef.current.getAvailableEffects());
            setActiveEffect(rendererRef.current.getAvailableEffects()[0] || '');
        }
    }, [rendererRef.current]);


    const handleNewImage = () => {
        setImageVersion(v => v + 1);
        if (rendererRef.current) {
            rendererRef.current.loadRandomImage();
        }
    };

    // --- NEW HANDLER FOR CHANGING EFFECTS ---
    const handleEffectChange = (effectName: string) => {
        if (rendererRef.current) {
            rendererRef.current.setActiveEffect(effectName);
            setActiveEffect(effectName);
        }
    };

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        if (autoChangeEnabled && (mode === 'image' || mode === 'effect')) {
            intervalId = setInterval(handleNewImage, autoChangeDelay * 1000);
        }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [autoChangeEnabled, autoChangeDelay, mode]);

    return (
        <div id="app-container">
            <h1>React & WebGPU Renderer</h1>
            {/* The Controls component now receives the new props it needs */}
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onNewImage={handleNewImage}
                autoChangeEnabled={autoChangeEnabled}
                setAutoChangeEnabled={setAutoChangeEnabled}
                autoChangeDelay={autoChangeDelay}
                setAutoChangeDelay={setAutoChangeDelay}
                availableEffects={availableEffects}
                activeEffect={activeEffect}
                setActiveEffect={handleEffectChange}
            />
            <WebGPUCanvas
                // Pass the ref so the canvas can set the renderer instance
                rendererRef={rendererRef}
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
