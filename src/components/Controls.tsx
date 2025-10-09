import React from 'react';
import { RenderMode } from '../renderer/types';

interface ControlsProps {
    mode: RenderMode;
    setMode: (mode: RenderMode) => void;
    onNewImage: () => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
    // For 3D Zoom
    depthThreshold: number; setDepthThreshold: (v: number) => void;
    edgeHardness: number; setEdgeHardness: (v: number) => void;
    depthLevels: number; setDepthLevels: (v: number) => void;
    fogColor: string; setFogColor: (v: string) => void;
    fogDensity: number; setFogDensity: (v: number) => void;
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
                <button onClick={props.onNewImage}>Load New Random Image</button>
            </div>

            {props.mode === '3d-zoom' && (<>
                <div className="control-group">
                    <label htmlFor="depth-slider">Depth Cutoff:</label>
                    <input type="range" id="depth-slider" min="0" max="100" value={props.depthThreshold * 100} onChange={(e) => props.setDepthThreshold(parseFloat(e.target.value) / 100)} />
                </div>
                <div className="control-group">
                    <label htmlFor="hardness-slider">Edge Hardness:</label>
                    <input type="range" id="hardness-slider" min="1" max="100" value={props.edgeHardness * 100} onChange={(e) => props.setEdgeHardness(parseFloat(e.target.value) / 100)} />
                </div>
                <div className="control-group">
                    <label htmlFor="levels-slider">Depth Levels:</label>
                    <input type="range" id="levels-slider" min="2" max="16" step="1" value={props.depthLevels} onChange={(e) => props.setDepthLevels(Number(e.target.value))} />
                </div>
                <div className="control-group">
                    <label htmlFor="fog-color">Fog Color:</label>
                    <input type="color" id="fog-color" value={props.fogColor} onChange={(e) => props.setFogColor(e.target.value)} />
                </div>
                <div className="control-group">
                    <label htmlFor="fog-density">Fog Density:</label>
                    <input type="range" id="fog-density" min="0" max="100" value={props.fogDensity * 10} onChange={(e) => props.setFogDensity(parseFloat(e.target.value) / 10)} />
                </div>
                <div className="control-group">
                    <label htmlFor="parallax-strength">Parallax Strength:</label>
                    <input type="range" id="parallax-strength" min="0" max="100" value={props.parallaxStrength * 1000} onChange={(e) => props.setParallaxStrength(parseFloat(e.target.value) / 1000)} />
                </div>
            </>)}

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
