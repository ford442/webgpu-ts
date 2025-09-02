import React from 'react';
import { RenderMode } from '../renderer/Renderer';

interface ControlsProps {
    mode: RenderMode;
    setMode: (mode: RenderMode) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    panX: number;
    setPanX: (panX: number) => void;
    panY: number;
    setPanY: (panY: number) => void;
    onVideo1Change: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onVideo2Change: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Controls: React.FC<ControlsProps> = ({ mode, setMode, zoom, setZoom, panX, setPanX, panY, setPanY, onVideo1Change, onVideo2Change }) => {
    return (
        <div className="controls">
            <div className="control-group">
                <label htmlFor="mode-select">Render Mode:</label>
                <select id="mode-select" value={mode} onChange={(e) => setMode(e.target.value as RenderMode)}>
                    <option value="shader">Galaxy Shader</option>
                    <option value="image">Static Image</option>
                    <option value="video">Video Texture</option>
                    <option value="depthMerge">Depth Merge</option>
                </select>
            </div>
            <div className="control-group">
                <label htmlFor="video1-upload">Video 1 (with depth):</label>
                <input type="file" id="video1-upload" accept="video/*" onChange={onVideo1Change} />
            </div>
            <div className="control-group">
                <label htmlFor="video2-upload">Video 2 (background):</label>
                <input type="file" id="video2-upload" accept="video/*" onChange={onVideo2Change} />
            </div>
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
