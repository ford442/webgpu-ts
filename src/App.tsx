import React, { useState, useEffect, useRef } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import Controls from './components/Controls';
import { RenderMode } from './renderer/Renderer';
import './style.css';

function App() {
    const [mode, setMode] = useState<RenderMode>('liquid');
    const [zoom, setZoom] = useState(1.0);
    const [panX, setPanX] = useState(0.5);
    const [panY, setPanY] = useState(0.5);
    const [imageVersion, setImageVersion] = useState(0);
    const [autoChangeEnabled, setAutoChangeEnabled] = useState(false);
    const [autoChangeDelay, setAutoChangeDelay] = useState(5);
    const [audioData, setAudioData] = useState<Uint8Array | null>(null);

    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);

    const handleNewImage = () => {
        setImageVersion(v => v + 1);
    };

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;
        if (autoChangeEnabled && (mode === 'image' || mode === 'ripple')) {
            intervalId = setInterval(handleNewImage, autoChangeDelay * 1000);
        }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [autoChangeEnabled, autoChangeDelay, mode]);

    useEffect(() => {
        const audioFileInput = document.getElementById('audio-file') as HTMLInputElement;
        const audioPlayer = document.getElementById('audio-player') as HTMLAudioElement;

        const handleFileChange = (event: Event) => {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 256;
                const bufferLength = analyserRef.current.frequencyBinCount;
                dataArrayRef.current = new Uint8Array(bufferLength);
            }

            const file = (event.target as HTMLInputElement).files?.[0];
            if (file && audioPlayer && audioContextRef.current && analyserRef.current) {
                const fileURL = URL.createObjectURL(file);
                audioPlayer.src = fileURL;

                const source = audioContextRef.current.createMediaElementSource(audioPlayer);
                source.connect(analyserRef.current);
                analyserRef.current.connect(audioContextRef.current.destination);

                audioPlayer.play();
            }
        };

        audioFileInput.addEventListener('change', handleFileChange);

        return () => {
            audioFileInput.removeEventListener('change', handleFileChange);
        };
    }, []);

    useEffect(() => {
        const animate = () => {
            if (analyserRef.current && dataArrayRef.current) {
                analyserRef.current.getByteFrequencyData(dataArrayRef.current);
                setAudioData(new Uint8Array(dataArrayRef.current));
            }
            requestAnimationFrame(animate);
        };
        animate();
    }, []);


    return (
        <div id="app-container">
            <h1>React & WebGPU Renderer</h1>
            <Controls
                mode={mode} setMode={setMode}
                zoom={zoom} setZoom={setZoom}
                panX={panX} setPanX={setPanX}
                panY={panY} setPanY={setPanY}
                onNewImage={handleNewImage}
                autoChangeEnabled={autoChangeEnabled}
                setAutoChangeEnabled={setAutoChangeEnabled}
                autoChangeDelay={autoChangeDelay}
                setAutoChangeDelay={setAutoChangeDelay}
            />
            <WebGPUCanvas
                mode={mode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                imageVersion={imageVersion}
                audioData={audioData}
            />
        </div>
    );
}

export default App;
