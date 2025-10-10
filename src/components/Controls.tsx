// src/components/Controls.tsx

import React from 'react';
import { RenderMode } from '../renderer/types';

interface ControlsProps {
    mode: RenderMode; // ADD THIS LINE
    setMode: (mode: RenderMode) => void; // ADD THIS LINE
    zoom: number;
    setZoom: (zoom: number) => void;
    panX: number;
    setPanX: (panX: number) => void;
    panY: number;
    setPanY: (panY: number) => void;
    onNewImage: () => void;
    autoChangeEnabled: boolean;
    setAutoChangeEnabled: (enabled: boolean) => void;
    autoChangeDelay: number;
    setAutoChangeDelay: (delay: number) => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
}

const Controls: React.FC<ControlsProps> = ({
    mode, setMode, // ADD THIS LINE
    zoom, setZoom,
    panX, setPanX,
    panY, setPanY,
    onNewImage,
    autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay,
    onLoadModel, isModelLoaded
}) => {
    // The previous logic for `isImageMode` is no longer needed since you are always showing these controls.

    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
                    <option value="liquid-perspective">Liquid Perspective</option>
                </select>
            </div>
            <div className="control-group">
                <button onClick={onLoadModel} disabled={isModelLoaded}>
                    {isModelLoaded ? 'AI Model Loaded' : 'Load AI Model'}
                </button>
                <button onClick={onNewImage}>Load New Random Image</button>
            </div>
            <>
                <div className="control-group">
                    <label></label>
                    <button onClick={onNewImage}>New Random Image</button>
                </div>
                <div className="control-group">
                    <label htmlFor="auto-change-toggle">Auto Change:</label>
                    <input type="checkbox" id="auto-change-toggle" checked={autoChangeEnabled} onChange={(e) => setAutoChangeEnabled(e.target.checked)} />
                </div>
                {autoChangeEnabled && (
                    <div className="control-group">
                        <label htmlFor="delay-slider">Delay ({autoChangeDelay}s):</label>
                        <input type="range" id="delay-slider" min="1" max="10" step="1" value={autoChangeDelay} onChange={(e) => setAutoChangeDelay(Number(e.target.value))} />
                    </div>
                )}
            </>
            <div className="control-group">
                <label htmlFor="zoom-slider">Zoom:</label>
                <input type="range" id="zoom-slider" min="50" max="200" value={zoom * 100} onChange={(e) => setZoom(parseFloat(e.target.value) / 100)} />
            </div>
            <div className="control-group">
                <label htmlFor="pan-x-slider">Pan X:</label>
                <input type="range" id="pan-x-slider" min="0" max="200" value={panX * 100} onChange={(e) => setPanX(parseFloat(e.target.value) / 100)} />
            </div>
            <div className="control-group">
                <label htmlFor="pan-y-slider">Pan Y:</label>
                <input type="range" id="pan-y-slider" min="0" max="200" value={panY * 100} onChange={(e) => setPanY(parseFloat(e.target.value) / 100)} />
            </div>
        </div>
    );
};

export default Controls;
