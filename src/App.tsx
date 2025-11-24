import React from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import './style.css';

function App() {
  return (
    <div id="app-container" style={{ width: '100%', height: '100%', overflow: 'hidden', margin: 0, padding: 0 }}>
        <div style={{ position: 'absolute', top: 10, left: 10, color: 'white', zIndex: 10, pointerEvents: 'none' }}>
            <h1>Forest Walker</h1>
            <p>Right-Click to Move Forward, S/A/D to Move, Space to Jump, Double-Tap to Dodge (Debug: `)</p>
        </div>
        <WebGPUCanvas />
    </div>
);
}

export default App;
