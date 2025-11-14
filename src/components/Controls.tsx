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
    // Stained glass tunables
    cellSize: number;
    setCellSize: (v: number) => void;
    edgeWidth: number;
    setEdgeWidth: (v: number) => void;
    refraction: number;
    setRefraction: (v: number) => void;
    colorStrength: number;
    setColorStrength: (v: number) => void;
    // Zoom preset for zoom effects: 0=subtle,1=dreamy,2=aggressive
    zoomPreset: number;
    setZoomPreset: (v: number) => void;
    // Audio controls
    audioUrl: string;
    setAudioUrl: (url: string) => void;
    startAudio: () => Promise<void>;
    stopAudio: () => void;
    audioRunning: boolean;
}

const Controls: React.FC<ControlsProps> = ({
    mode, setMode, // ADD THIS LINE
    zoom, setZoom,
    panX, setPanX,
    panY, setPanY,
    onNewImage,
    autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay,
    onLoadModel, isModelLoaded,
    cellSize, setCellSize,
    edgeWidth, setEdgeWidth,
    refraction, setRefraction,
    colorStrength, setColorStrength,
    zoomPreset, setZoomPreset,
    audioUrl, setAudioUrl, startAudio, stopAudio, audioRunning,
}) => {
    // The previous logic for `isImageMode` is no longer needed since you are always showing these controls.

    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                 <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
    <option value="vortex">Clean Vortex</option> {/* ADD THIS */}
    <option value="liquid-perspective">Liquid Perspective</option>
    <option value="liquid-alt">Liquid (Alternate)</option>
    <option value="liquid-alt2">Liquid (Alternate v2)</option>
    <option value="liquid-vortex">Liquid Vortex</option>
    <option value="liquid">Liquid (Interactive)</option>
    <option value="liquid-zoom">Liquid Zoom</option>
    <option value="shader">Galaxy Shader</option>
    <option value="galaxy-alt">Galaxy (Alternate)</option>
    <option value="music-gui">Music GUI</option>
                    <option value="image">Static Image</option>
                    <option value="ripple">Ripple Effect</option>
                    <option value="video">Video Texture</option>
                    <option value="video-effect">Video Effect (Realtime)</option>
                    <option value="video-stained">Video Effect (Stained Glass)</option>
                    <option value="liquid-v1">Liquid (Ambient)</option>
                    <option value="pinball">Pinball (Game)</option>
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
                <label htmlFor="zoom-preset">Zoom Preset:</label>
                <select id="zoom-preset" value={zoomPreset} onChange={(e) => setZoomPreset(Number(e.target.value))}>
                    <option value={0}>Subtle</option>
                    <option value={1}>Dreamy</option>
                    <option value={2}>Aggressive</option>
                </select>
            </div>
            <div className="control-group">
                <label htmlFor="pan-x-slider">Pan X:</label>
                <input type="range" id="pan-x-slider" min="0" max="200" value={panX * 100} onChange={(e) => setPanX(parseFloat(e.target.value) / 100)} />
            </div>
            <div className="control-group">
                <label htmlFor="pan-y-slider">Pan Y:</label>
                <input type="range" id="pan-y-slider" min="0" max="200" value={panY * 100} onChange={(e) => setPanY(parseFloat(e.target.value) / 100)} />
            </div>
            <div className="control-group">
                <label htmlFor="cell-size">Stained Cell Size: {cellSize.toFixed(3)}</label>
                <input id="cell-size" type="range" min="0.01" max="0.15" step="0.001" value={cellSize} onChange={(e) => setCellSize(Number(e.target.value))} />
            </div>
            <div className="control-group">
                <label htmlFor="edge-width">Lead Edge Width: {edgeWidth.toFixed(3)}</label>
                <input id="edge-width" type="range" min="0.0" max="0.2" step="0.001" value={edgeWidth} onChange={(e) => setEdgeWidth(Number(e.target.value))} />
            </div>
            <div className="control-group">
                <label htmlFor="refraction">Refraction Strength: {refraction.toFixed(3)}</label>
                <input id="refraction" type="range" min="0.0" max="0.06" step="0.001" value={refraction} onChange={(e) => setRefraction(Number(e.target.value))} />
            </div>
            <div className="control-group">
                <label htmlFor="color-strength">Color Strength: {colorStrength.toFixed(2)}</label>
                <input id="color-strength" type="range" min="0.0" max="2.0" step="0.01" value={colorStrength} onChange={(e) => setColorStrength(Number(e.target.value))} />
            </div>
            <div className="control-group">
                <label htmlFor="audio-url">Audio Stream URL:</label>
                <input id="audio-url" type="text" value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} style={{ width: '100%' }} />
                <div style={{marginTop: 6}}>
                    <button onClick={() => startAudio()} disabled={audioRunning}>Start Audio</button>
                    <button onClick={() => stopAudio()} disabled={!audioRunning} style={{marginLeft:8}}>Stop Audio</button>
                </div>
            </div>
        </div>
    );
};

export default Controls;
