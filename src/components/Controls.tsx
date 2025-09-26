import React from 'react';

interface ControlsProps {
    imageUrl: string;
    setImageUrl: (url: string) => void;
    onLoadModel: () => void;
    onAnalyze: (url: string) => void;
    onLoadRandom: () => void;
    displacementScale: number;
    setDisplacementScale: (value: number) => void;
    ambientLight: number;
    setAmbientLight: (value: number) => void;
    smoothness: number;
    setSmoothness: (value: number) => void;
}

const Slider: React.FC<{label: string, value: number, onChange: (val: number) => void, min: string, max: string, step: string, id: string}> = ({ label, value, onChange, ...props }) => (
    <div className="control-group">
        <label htmlFor={props.id}>{label}:</label>
        <input type="range" value={value} onChange={e => onChange(parseFloat(e.target.value))} {...props} />
        <span>{value.toFixed(2)}</span>
    </div>
);

const Controls: React.FC<ControlsProps> = ({
    imageUrl, setImageUrl,
    onLoadModel, onAnalyze,
    onLoadRandom,
    displacementScale, setDisplacementScale,
    ambientLight, setAmbientLight,
    smoothness, setSmoothness
}) => {
    return (
        <div className="controls">
            <div className="control-group">
                <button onClick={onLoadModel}>1. Load Model</button>
                <button onClick={onLoadRandom}>Load Random Image</button>
            </div>
            <div className="control-group">
                <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ width: '400px' }} />
                <button onClick={() => onAnalyze(imageUrl)}>2. Analyze from URL</button>
            </div>
            <Slider label="Displacement Scale" id="d_scale" value={displacementScale} onChange={setDisplacementScale} min="0" max="1.0" step="0.01" />
            <Slider label="Smoothness" id="d_smooth" value={smoothness} onChange={setSmoothness} min="0" max="5.0" step="0.1" />
            <Slider label="Ambient Light" id="p_amb" value={ambientLight} onChange={setAmbientLight} min="0" max="1.0" step="0.01" />
        </div>
    );
};

export default Controls;
