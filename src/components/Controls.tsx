// src/components/Controls.tsx

import React from 'react';

interface ControlsProps {
    onNewImage: () => void;
    autoChangeEnabled: boolean;
    setAutoChangeEnabled: (enabled: boolean) => void;
    autoChangeDelay: number;
    setAutoChangeDelay: (delay: number) => void;
    onLoadModel: () => void;
    isModelLoaded: boolean;
    onLoadEffect: (shaderUrl: string, type: 'render' | 'compute') => void;
}

const Controls: React.FC<ControlsProps> = ({
    onNewImage,
    autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay,
    onLoadModel, isModelLoaded,
    onLoadEffect
}) => {
    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
            <button onClick={() => onLoadEffect('https://glsl.1ink.us/effects/galaxy.wgsl', 'render')}>
                Load Galaxy (Render)
            </button>
            <button onClick={() => onLoadEffect('https://glsl.1ink.us/effects/liquid.wgsl', 'compute')}>
                Load Liquid (Compute)
            </button>
            <button onClick={() => onLoadEffect('https://glsl.1ink.us/effects/vortex.wgsl', 'compute')}>
                Load Vortex (Compute)
            </button>
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
        </div>
    );
};

export default Controls;
