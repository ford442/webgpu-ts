import React, { useState, useRef, useEffect } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import StreetView from './components/StreetView';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import './style.css';

function App() {
  const [mode, setMode] = useState<RenderMode>('streetview');
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0.5);
  const [panY, setPanY] = useState(0.5);

  // --- Street View / Connect States ---
  const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // *** PASTE YOUR API KEY HERE ***
  const GOOGLE_MAPS_KEY = "AIzaSy...";

  const rendererRef = useRef<Renderer | null>(null);

  // Dummy props for Controls (since we are stripping down for Street View)
  const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
  const [autoChangeDelay, setAutoChangeDelay] = useState(10);
  const [cellSize, setCellSize] = useState(0.035);
  const [edgeWidth, setEdgeWidth] = useState(0.06);
  const [refraction, setRefraction] = useState(0.02);
  const [colorStrength, setColorStrength] = useState(1.0);
  const [zoomPreset, setZoomPreset] = useState(1);
  const [audioUrl, setAudioUrl] = useState('');
  const [isAudioRunning, setIsAudioRunning] = useState(false);

  return (
    <div id="app-container" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', padding: 0, margin: 0 }}>

        {/* 1. STREET VIEW LAYER (Bottom) */}
        {/* Always rendered so Google Maps stays alive. Hidden via z-index when connected. */}
        <div style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%', height: '100%',
            zIndex: isConnected ? 0 : 2
        }}>
            <StreetView
                apiKey={GOOGLE_MAPS_KEY}
                onCanvasReady={(canvas) => setStreetViewCanvas(canvas)}
            />
        </div>

        {/* 2. WEBGPU LAYER (Top) */}
        {/* Only visible after connecting. */}
        <div style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%', height: '100%',
            zIndex: isConnected ? 2 : 0,
            pointerEvents: isConnected ? 'auto' : 'none',
            opacity: isConnected ? 1 : 0 // Hide WebGPU canvas until connected
        }}>
            <WebGPUCanvas
                rendererRef={rendererRef}
                mode={mode}
                // Only pass the source if we are officially "connected"
                source={isConnected ? streetViewCanvas : null}
                zoom={zoom}
                panX={panX}
                panY={panY}
                farthestPoint={{x:0.5, y:0.5}}
                mousePosition={{x:-1, y:-1}}
                setMousePosition={() => {}}
                isMouseDown={false}
                setIsMouseDown={() => {}}
            />
        </div>

        {/* 3. UI OVERLAY (Very Top) */}
        <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>

            {/* THE CONNECT BUTTON */}
            {!isConnected && (
                <button
                    onClick={() => setIsConnected(true)}
                    disabled={!streetViewCanvas}
                    style={{
                        padding: '15px 30px',
                        fontSize: '1.2rem',
                        backgroundColor: streetViewCanvas ? '#4CAF50' : '#555',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: streetViewCanvas ? 'pointer' : 'wait',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
                    }}
                >
                    {streetViewCanvas ? "START SIMULATION" : "Waiting for Maps..."}
                </button>
            )}

            {/* DISCONNECT BUTTON (Optional) */}
            {isConnected && (
                <button
                    onClick={() => setIsConnected(false)}
                    style={{ padding: '8px 16px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                    Stop / Change View
                </button>
            )}

            {/* Existing Controls (Visible only when connected) */}
            {isConnected && (
                <div style={{ background: 'rgba(0,0,0,0.8)', padding: 15, borderRadius: 8 }}>
                    <Controls
                        mode={mode} setMode={setMode}
                        zoom={zoom} setZoom={setZoom}
                        panX={panX} setPanX={setPanX}
                        panY={panY} setPanY={setPanY}
                        // Fill dummy props
                        onNewImage={()=>{}} autoChangeEnabled={false} setAutoChangeEnabled={()=>{}}
                        autoChangeDelay={0} setAutoChangeDelay={()=>{}}
                        onLoadModel={()=>{}} isModelLoaded={false}
                        cellSize={cellSize} setCellSize={setCellSize}
                        edgeWidth={edgeWidth} setEdgeWidth={setEdgeWidth}
                        refraction={refraction} setRefraction={setRefraction}
                        colorStrength={colorStrength} setColorStrength={setColorStrength}
                        zoomPreset={zoomPreset} setZoomPreset={setZoomPreset}
                        audioUrl={audioUrl} setAudioUrl={setAudioUrl}
                        startAudio={async ()=>{}} stopAudio={()=>{}} audioRunning={false}
                    />
                </div>
            )}
        </div>
    </div>
  );
}

export default App;
