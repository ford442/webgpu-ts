import React, { useRef, useEffect, useState } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
    resetVersion: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, imageVersion, resetVersion }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);
    const lastMouseAddTime = useRef(0);
    const [isMouseDown, setIsMouseDown] = useState(false);
    const lastMousePos = useRef<{x: number, y: number}>({ x: 0, y: 0 });

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        rendererRef.current = renderer;
        
        (async () => {
            const success = await renderer.init();
            if (success) {
                videoRef.current = document.createElement('video');
                videoRef.current.src = 'https://test.1ink.us/webgputs/big_buck_bunny_720p_surround.mp4';
                videoRef.current.crossOrigin = 'anonymous';
                videoRef.current.muted = true; videoRef.current.loop = true;
                videoRef.current.autoplay = true; videoRef.current.playsInline = true;
                await videoRef.current.play().catch(console.error);
            }
        })();
        return () => cancelAnimationFrame(animationFrameId.current);
    }, []);
    
    useEffect(() => {
        if (rendererRef.current && imageVersion > 0) {
            rendererRef.current.loadRandomImage();
        }
    }, [imageVersion]);
    
   useEffect(() => {
        // Don't reset on the initial load
        if (rendererRef.current && resetVersion > 0) {
            rendererRef.current.resetSimulation();
        }
    }, [resetVersion]);
    
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current && videoRef.current) {
                rendererRef.current.render(mode, videoRef.current, zoom, panX, panY);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY]);

    const addRippleAtMouseEvent = (event: React.MouseEvent<HTMLCanvasElement>) => { /* ... unchanged ... */ };
    
    // --- v3 MOUSE HANDLING ---
    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        setIsMouseDown(true);
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = (event.clientX - rect.left) / canvasRef.current!.width;
        const y = (event.clientY - rect.top) / canvasRef.current!.height;
        lastMousePos.current = { x, y };

        if (mode.startsWith('liquid') && mode !== 'liquid-v3') {
            addRippleAtMouseEvent(event);
        } else if (mode === 'liquid-v3' && rendererRef.current) {
            rendererRef.current.updateMouse(x, y, 0, 0, true);
        }
    };

    const handleMouseUp = () => {
        setIsMouseDown(false);
        if (mode === 'liquid-v3' && rendererRef.current) {
            rendererRef.current.updateMouse(0, 0, 0, 0, false);
        }
    };

    const handleMouseLeave = handleMouseUp; // Treat leaving the canvas as letting go

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = (event.clientX - rect.left) / canvasRef.current!.width;
        const y = (event.clientY - rect.top) / canvasRef.current!.height;

        if (isMouseDown) {
            if (mode.startsWith('liquid') && mode !== 'liquid-v3') {
                const now = performance.now();
                if (now - lastMouseAddTime.current < 10) return;
                lastMouseAddTime.current = now;
                addRippleAtMouseEvent(event);
            } else if (mode === 'liquid-v3' && rendererRef.current) {
                const deltaX = x - lastMousePos.current.x;
                const deltaY = y - lastMousePos.current.y;
                rendererRef.current.updateMouse(x, y, deltaX, deltaY, true);
                lastMousePos.current = { x, y };
            }
        }
    };

    return (
        <canvas ref={canvasRef} width="800" height="600" onMouseMove={handleCanvasMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
    );
};

export default WebGPUCanvas;
