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
    // For 3D Parallax
    displacementScale: number; setDisplacementScale: (v: number) => void;
    ambientLight: number; setAmbientLight: (v: number) => void;
    smoothness: number; setSmoothness: (v: number) => void;
    pointSize: number; setPointSize: (v: number) => void;
}

const Controls: React.FC<ControlsProps> = (props) => {
    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={props.mode} onChange={(e) => props.setMode(e.target.value as RenderMode)}>
                    <option value="3d-zoom">Continuous Zoom</option>
                    <option value="3d-parallax">3D Parallax Mesh</option>
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

            {/* --- Sliders for 3D Parallax --- */}
            {props.mode === '3d-parallax' && (<>
                 <div className="control-group">
                    <label htmlFor="d-scale">Displacement:</label>
                    <input type="range" id="d-scale" min="0" max="1" step="0.01" value={props.displacementScale} onChange={(e) => props.setDisplacementScale(parseFloat(e.target.value))} />
                </div>
                 <div className="control-group">
                    <label htmlFor="smooth">Smoothness:</label>
                    <input type="range" id="smooth" min="0" max="5" step="0.1" value={props.smoothness} onChange={(e) => props.setSmoothness(parseFloat(e.target.value))} />
                </div>
                 <div className="control-group">
                    <label htmlFor="p-size">Point Size:</label>
                    <input type="range" id="p-size" min="1" max="10" step="0.1" value={props.pointSize} onChange={(e) => props.setPointSize(parseFloat(e.target.value))} />
                </div>
                 <div className="control-group">
                    <label htmlFor="amb-light">Ambient Light:</label>
                    <input type="range" id="amb-light" min="0" max="1" step="0.01" value={props.ambientLight} onChange={(e) => props.setAmbientLight(parseFloat(e.target.value))} />
                </div>
            </>)}
        </div>
    );
};

export default Controls;
