import React from 'react';
import { RenderMode } from '../renderer/types';


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
}

const Controls: React.FC<ControlsProps> = ({ 
    mode, setMode, 
    zoom, setZoom, 
    panX, setPanX, 
    panY, setPanY, 
    onNewImage,
    autoChangeEnabled, setAutoChangeEnabled,
    autoChangeDelay, setAutoChangeDelay,
    onLoadModel, isModelLoaded // NEW
}) => {
    const isImageMode = mode.startsWith('liquid') || mode === 'image' || mode === 'ripple';

    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                {/* MODIFIED: This dropdown now uses the new setMode function */}
                <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
                    <option value="liquid-v1">Dynamic Lighting</option>
                    {/* TODO: As you convert other shaders (like liquid.wgsl) into their own 
                      mode modules, you will add their options back here.
                    */}
                </select>
            </div>
        </div>
    );
};

export default Controls;
