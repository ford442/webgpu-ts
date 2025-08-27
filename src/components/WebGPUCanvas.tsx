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
                // --- UPDATE THIS LINE ---
                videoRef.current.src = 'https://test.1ink.us/webgputs/big_buck_bunny_720p_surround.mp4';
                videoRef.current.crossOrigin = 'anonymous'; // Good practice for CORS media
                // ---
                videoRef.current.muted = true;
                videoRef.current.loop = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                videoRef.current.play().catch(err => {
                    console.error("Video play failed:", err);
                });

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

    return <canvas ref={canvasRef} width="800" height="600" />;
};

export default WebGPUCanvas;
