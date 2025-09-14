import React, { useRef, useEffect, useState, MutableRefObject } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    rendererRef: MutableRefObject<Renderer | null>; // Accept the ref from App
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ rendererRef, mode, zoom, panX, panY, imageVersion }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
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
                rendererRef.current = renderer; // Set the renderer instance on the ref
                videoRef.current = document.createElement('video');
                // ... (rest of the video setup)
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
    }, []); // Run only once on mount


    useEffect(() => {
        let active = true;

        const animate = () => {
            if (!active) return;
            // Now we use the ref to call render
            if (rendererRef.current && videoRef.current) {
                rendererRef.current.render(mode, videoRef.current);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        
        animate();

        return () => {
            active = false;
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [mode, zoom, panX, panY]); // Dependencies remain the same

    const handleMouseDown = () => setIsMouseDown(true);
    const handleMouseUp = () => setIsMouseDown(false);
    const handleMouseLeave = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
       // This logic can be moved into a specific "Ripple" effect class later
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
