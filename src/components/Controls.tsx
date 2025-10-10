import React from 'react';
import { RenderMode } from '../renderer/types';

export type ModelDType = 'fp32' | 'q8' | 'q4';

interface ControlsProps {
    mode: RenderMode;
    setMode: (mode: RenderMode) => void;
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
    modelDtype: ModelDType; // MODIFIED
    setModelDtype: (dtype: ModelDType) => void; // MODIFIED
}

const Controls: React.FC<ControlsProps> = ({ 
    mode, setMode, 
    zoom, setZoom, 
    panX, setPanX, 
    panY, setPanY, 
    onNewImage,
    autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay,
    onLoadModel, isModelLoaded,
    modelDtype, setModelDtype // MODIFIED
}) => {
    const isImageMode = mode.startsWith('liquid') || mode === 'image' || mode === 'ripple';

    return (
<div className="controls">
<div className="control-group">
                <label htmlFor="model-type-select">AI Model Type:</label>
                <select 
                    id="model-type-select" 
                    value={modelDtype} 
                    onChange={(e) => setModelDtype(e.target.value as ModelDType)}
                    disabled={isModelLoaded}
                >
                    <option value="fp32">Default (FP32)</option>
                    <option value="q8">Quantized (INT8)</option>
                    <option value="q4">Quantized (INT4)</option>
                </select>
            </div>
            <div className="control-group">
        <button onClick={onLoadModel} disabled={isModelLoaded}>
          {isModelLoaded ? 'AI Model Loaded' : 'Load AI Model'}
        </button>
        <button onClick={onNewImage}>Load New Random Image</button>
      </div>
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
    <option value="liquid-v1">Dynamic Lighting</option>
    <option value="liquid">Interactive Liquid</option> {/* ADD THIS OPTION */}
</select>
            </div>
        </div>
    );
};

export default Controls;
