import React, { useRef, useEffect } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        renderer.init().then(success => {
            if (success) {
                rendererRef.current = renderer;
                videoRef.current = document.createElement('video');
                videoRef.current.src = 'https://www.w3schools.com/html/mov_bbb.mp4';
                videoRef.current.muted = true;
                videoRef.current.loop = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                videoRef.current.play();

                const animate = () => {
                    if (rendererRef.current && videoRef.current) {
                        rendererRef.current.render(mode, videoRef.current, zoom, panX, panY);
                    }
                    requestAnimationFrame(animate);
                };
                animate();
            }
        });

        return () => {
            // Cleanup logic if needed
        };
    }, []); // Empty dependency array ensures this runs only once on mount

    // Re-trigger render when props change
    useEffect(() => {
        if (rendererRef.current && videoRef.current) {
            rendererRef.current.render(mode, videoRef.current, zoom, panX, panY);
        }
    }, [mode, zoom, panX, panY]);

    return <canvas ref={canvasRef} width="800" height="600" />;
};

export default WebGPUCanvas;
