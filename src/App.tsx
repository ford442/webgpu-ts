import React, { useState, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/types';
import './style.css';
import StreetView from './components/StreetView';

function App() {
  const [mode] = useState<RenderMode>('streetview');
  const [streetViewCanvas, setStreetViewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);
  const [heading, setHeading] = useState(34);
  const [pitch, setPitch] = useState(10);
  const [zoom, setZoom] = useState(1);
  const [mapVisible, setMapVisible] = useState(true);
  const apiKey = 'AIzaSyABKwxIeRZX7VcFIejGkpSplxST_E0-Xn0';

  // Handler for StreetView canvas
  const handleStreetViewCanvas = useCallback((canvas: HTMLCanvasElement) => {
    setStreetViewCanvas(canvas);
  }, []);

  // Handler for panorama instance
  const handlePanoramaReady = useCallback((pano: google.maps.StreetViewPanorama) => {
    setPanorama(pano);
  }, []);

  // Navigation controls
  const updatePOV = useCallback((newHeading: number, newPitch: number) => {
    if (panorama) {
      panorama.setPov({ heading: newHeading, pitch: newPitch });
      setHeading(newHeading);
      setPitch(newPitch);
    }
  }, [panorama]);

  const updateZoom = useCallback((newZoom: number) => {
    if (panorama) {
      panorama.setZoom(newZoom);
      setZoom(newZoom);
    }
  }, [panorama]);

  const movePosition = useCallback((direction: 'forward' | 'backward' | 'left' | 'right') => {
    if (!panorama) return;
    
    const pov = panorama.getPov();
    const position = panorama.getPosition();
    if (!position) return;

    // Calculate movement based on heading
    const headingRad = (pov.heading || 0) * (Math.PI / 180);
    const distance = 0.0001; // approximately 11 meters

    let latOffset = 0;
    let lngOffset = 0;

    switch (direction) {
      case 'forward':
        latOffset = Math.cos(headingRad) * distance;
        lngOffset = Math.sin(headingRad) * distance;
        break;
      case 'backward':
        latOffset = -Math.cos(headingRad) * distance;
        lngOffset = -Math.sin(headingRad) * distance;
        break;
      case 'left':
        latOffset = Math.cos(headingRad - Math.PI / 2) * distance;
        lngOffset = Math.sin(headingRad - Math.PI / 2) * distance;
        break;
      case 'right':
        latOffset = Math.cos(headingRad + Math.PI / 2) * distance;
        lngOffset = Math.sin(headingRad + Math.PI / 2) * distance;
        break;
    }

    const newPosition = {
      lat: position.lat() + latOffset,
      lng: position.lng() + lngOffset,
    };

    panorama.setPosition(newPosition);
  }, [panorama]);

  return (
    <div id="app-container">
        <h1>WebGPU StreetView Explorer</h1>
        <StreetView 
          onCanvasReady={handleStreetViewCanvas} 
          onPanoramaReady={handlePanoramaReady}
          apiKey={apiKey} 
        />
        <Controls
            mode={mode}
            heading={heading}
            pitch={pitch}
            zoom={zoom}
            mapVisible={mapVisible}
            setMapVisible={setMapVisible}
            onUpdatePOV={updatePOV}
            onUpdateZoom={updateZoom}
            onMove={movePosition}
            panorama={panorama}
        />
        <WebGPUCanvas
            mode={mode}
            source={streetViewCanvas}
        />
    </div>
  );
}

export default App;
