import React from 'react';
import { RenderMode } from '../renderer/types';

interface ControlsProps {
    mode: RenderMode;
    setMode: (mode: RenderMode) => void;
    onNewImage: () => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
    isRendererReady: boolean;
    // For 3D Zoom
    parallaxStrength: number; setParallaxStrength: (v: number) => void;
}

const Controls: React.FC<ControlsProps> = (props) => {
    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={props.mode} onChange={(e) => props.setMode(e.target.value as RenderMode)}>
                    <option value="3d-zoom">Continuous Zoom</option>
                    <option value="ambient-liquid">Ambient Liquid</option>
                </select>
            </div>
            <div className="control-group">
                <button onClick={props.onLoadModel} disabled={props.isModelLoaded}>
                    {props.isModelLoaded ? 'AI Model Loaded' : 'Load AI Model'}
                </button>
                <button onClick={props.onNewImage} disabled={!props.isRendererReady}>
                    Load New Random Image
                </button>
            </div>

            {/* --- Sliders for 3D Zoom --- */}
            {props.mode === '3d-zoom' && (
                <div className="control-group">
                    <label htmlFor="parallax-strength">Parallax Strength:</label>
                    <input type="range" id="parallax-strength" min="0" max="100" value={props.parallaxStrength * 1000} onChange={(e) => props.setParallaxStrength(parseFloat(e.target.value) / 1000)} />
                </div>
            )}
            
            {/* The Ambient Liquid mode has no sliders, so nothing will show for it */}
        </div>
    );
};

export default Controls;
