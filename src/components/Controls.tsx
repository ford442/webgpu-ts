import React from 'react';

interface ControlsProps {
    imageUrl: string;
    setImageUrl: (url: string) => void;
    onLoadModel: () => void;
    onAnalyze: (url: string) => void;
    parallaxStrength: number;
    setParallaxStrength: (value: number) => void;
    occlusionStrength: number;
    setOcclusionStrength: (value: number) => void;
    numSteps: number;
    setNumSteps: (value: number) => void;
    ambientLight: number;
    setAmbientLight: (value: number) => void;
}

const Slider: React.FC<{label: string, value: number, onChange: (val: number), min: string, max: string, step: string, id: string}> = ({ label, value, onChange, ...props }) => (
    <div className="control-group">
        <label htmlFor={props.id}>{label}:</label>
        <input type="range" value={value} onChange={e => onChange(parseFloat(e.target.value))} {...props} />
        <span>{value.toFixed(props.step.includes('0.000') ? 4 : (props.step.includes('0.00') ? 3 : 2))}</span>
    </div>
);

const Controls: React.FC<ControlsProps> = ({
    imageUrl, setImageUrl,
    onLoadModel, onAnalyze,
    parallaxStrength, setParallaxStrength,
    occlusionStrength, setOcclusionStrength,
    numSteps, setNumSteps,
    ambientLight, setAmbientLight
}) => {
    return (
        <div className="controls">
            <div className="control-group">
                <button onClick={onLoadModel}>1. Load Model</button>
            </div>
            <div className="control-group">
                <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ width: '400px' }} />
                <button onClick={() => onAnalyze(imageUrl)}>2. Analyze from URL</button>
            </div>
            <Slider label="Parallax Strength" id="p_str" value={parallaxStrength} onChange={setParallaxStrength} min="0" max="0.2" step="0.005" />
            <Slider label="Occlusion Strength" id="p_occ" value={occlusionStrength} onChange={setOcclusionStrength} min="0" max="1.0" step="0.01" />
            <Slider label="Raymarching Steps" id="p_steps" value={numSteps} onChange={setNumSteps} min="4" max="64" step="1" />
            <Slider label="Ambient Light" id="p_amb" value={ambientLight} onChange={setAmbientLight} min="0" max="1.0" step="0.01" />
        </div>
    );
};

export default Controls;
