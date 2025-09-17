import React, { useRef, useEffect, useState } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, imageVersion }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);
    const lastMouseAddTime = useRef(0);
    const [isMouseDown, setIsMouseDown] = useState(false);

    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        
        (async () => {
            const success = await renderer.init();
            if (success) {
                rendererRef.current = renderer;
                videoRef.current = document.createElement('video');
                videoRef.current.src = 'https://test.1ink.us/webgputs/big_buck_bunny_720p_surround.mp4';
                videoRef.current.crossOrigin = 'anonymous';
                videoRef.current.muted = true;
                videoRef.current.loop = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                await videoRef.current.play().catch(err => {
                    console.error("Video play failed:", err);
                });
            }
        })();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, []);

    // This useEffect handles loading a new random image when the button is clicked
    useEffect(() => {
        if (rendererRef.current && imageVersion > 0) { // imageVersion > 0 ensures it doesn't run on initial load
            rendererRef.current.loadRandomImage();
        }
    }, [imageVersion]);

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

        return () => {
            active = false;
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [mode, zoom, panX, panY]);

    const handleMouseDown = () => setIsMouseDown(true);
    const handleMouseUp = () => setIsMouseDown(false);
    const handleMouseLeave = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        // Updated condition to include 'liquid' mode
        if (rendererRef.current && (mode === 'ripple' || mode === 'liquid') && isMouseDown) {
            const now = performance.now();
            if (now - lastMouseAddTime.current < 50) return;
            lastMouseAddTime.current = now;

            const canvas = canvasRef.current!;
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) / canvas.width;
            const y = (event.clientY - rect.top) / canvas.height;
            rendererRef.current.addRipplePoint(x, y);
        }
    };

    return (
        <canvas 
            ref={canvasRef} 
            width="800" 
            height="600" 
            onMouseMove={handleCanvasMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
        />
    );
};

export default WebGPUCanvas;
