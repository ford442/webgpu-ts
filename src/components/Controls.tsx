import React from 'react';
import { RenderMode } from '../renderer/types';

interface ControlsProps {
    mode: RenderMode;
    setMode: (mode: RenderMode) => void;
    onNewImage: () => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
    depthThreshold: number;
    setDepthThreshold: (value: number) => void;
    edgeHardness: number;
    setEdgeHardness: (value: number) => void;
    depthLevels: number; // Add this
    setDepthLevels: (value: number) => void;
    // --- ADD NEW PROPS ---
    fogColor: string;
    setFogColor: (value: string) => void;
    fogDensity: number;
    setFogDensity: (value: number) => void;
    parallaxStrength: number;
    setParallaxStrength: (value: number) => void;
}

const Controls: React.FC<ControlsProps> = ({ 
    mode, setMode, 
    onNewImage,
    onLoadModel, isModelLoaded,
    depthThreshold, setDepthThreshold,
    edgeHardness, setEdgeHardness,
    depthLevels, setDepthLevels,
    fogColor, setFogColor,
    fogDensity, setFogDensity,
    parallaxStrength, setParallaxStrength
}) => {
    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
                    <option value="3d-zoom">3D Zoom</option>
                </select>
            </div>
            <div className="control-group">
                <button onClick={onLoadModel} disabled={isModelLoaded}>
                {isModelLoaded ? 'AI Model Loaded' : 'Load AI Model'}
                </button>
                <button onClick={onNewImage}>Load New Random Image</button>
            </div>
{/* --- NEW FOG AND PARALLAX CONTROLS --- */}
            <div className="control-group">
                <label htmlFor="fog-color">Fog Color:</label>
                <input 
                  type="color" 
                  id="fog-color" 
                  value={fogColor}
                  onChange={(e) => setFogColor(e.target.value)}
                />
            </div>
            <div className="control-group">
                <label htmlFor="fog-density">Fog Density:</label>
                <input 
                  type="range" id="fog-density" min="0" max="100" 
                  value={fogDensity * 10} 
                  onChange={(e) => setFogDensity(parseFloat(e.target.value) / 10)}
                />
            </div>
            <div className="control-group">
                <label htmlFor="parallax-strength">Parallax Strength:</label>
                <input 
                  type="range" id="parallax-strength" min="0" max="100" 
                  value={parallaxStrength * 1000} 
                  onChange={(e) => setParallaxStrength(parseFloat(e.target.value) / 1000)}
                />
            </div>
            <div className="control-group">
                <label htmlFor="depth-slider">Depth Cutoff:</label>
                <input 
                  type="range" 
                  id="depth-slider" 
                  min="0" 
                  max="100" 
                  value={depthThreshold * 100} 
                  onChange={(e) => setDepthThreshold(parseFloat(e.target.value) / 100)} 
                />
            </div>

            <div className="control-group">
                <label htmlFor="hardness-slider">Edge Hardness:</label>
                <input 
                  type="range" id="hardness-slider" min="1" max="100" 
                  value={edgeHardness * 100} 
                  onChange={(e) => setEdgeHardness(parseFloat(e.target.value) / 100)} 
                />
            </div>

            <div className="control-group">
                <label htmlFor="levels-slider">Depth Levels:</label>
                <input 
                  type="range" id="levels-slider" min="2" max="16" step="1"
                  value={depthLevels} 
                  onChange={(e) => setDepthLevels(Number(e.target.value))} 
                />
            </div>
        </div>
    );
};

export default Controls;
