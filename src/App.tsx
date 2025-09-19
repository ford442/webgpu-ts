import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
    const [autoChangeDelay, setAutoChangeDelay] = useState(5);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [liquidSource, setLiquidSource] = useState<'image' | 'video'>('image');
    const prevModeRef = useRef<RenderMode>(mode);

    useEffect(() => {
        if (mode.startsWith('liquid') && !prevModeRef.current.startsWith('liquid')) {
            if (prevModeRef.current === 'video') {
                setLiquidSource('video');
            } else {
                setLiquidSource('image');
            }
        }
        prevModeRef.current = mode;
    }, [mode]);

    const handleNewImage = () => {
        setImageVersion(v => v + 1);
    };

    const handleTogglePlay = () => {
        setIsPlaying(p => !p);
    };

    const handleVideoReady = useCallback((isReady: boolean) => {
        setIsVideoReady(isReady);
    }, []);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        if (autoChangeEnabled && (mode === 'image' || mode === 'ripple')) {
            intervalId = setInterval(handleNewImage, autoChangeDelay * 1000);
        }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [autoChangeEnabled, autoChangeDelay, mode]);

    const showVideoControls = (mode === 'video' || (mode.startsWith('liquid') && liquidSource === 'video')) && isVideoReady;

    return (
        <div id="app-container">
            <h1>React & WebGPU Renderer</h1>
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
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
                showVideoControls={showVideoControls}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageVersion={imageVersion}
                isPlaying={isPlaying}
                onVideoReady={handleVideoReady}
                liquidSource={liquidSource}
            />
        </div>
    );
}

export default App;
