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
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        
        // This is an IIFE (Immediately Invoked Function Expression) to use async/await
        (async () => {
            const success = await renderer.init();
            if (success) {
                rendererRef.current = renderer;
                videoRef.current = document.createElement('video');
                videoRef.current.src = 'https://test.1ink.us/webgputs/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';
                videoRef.current.crossOrigin = 'anonymous';
                videoRef.current.muted = true;
                videoRef.current.loop = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                await videoRef.current.play().catch(err => {
                    console.error("Video play failed:", err);
                });

                const animate = () => {
                    if (rendererRef.current && videoRef.current) {
                        // We will pass props directly in the render call
                    }
                    animationFrameId.current = requestAnimationFrame(animate);
                };
                // We will control the animation loop from the other useEffect
            }
        })();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, []);

    // This useEffect will now handle the rendering loop, re-starting it when props change.
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

    return <canvas ref={canvasRef} width="800" height="600" />;
};

export default WebGPUCanvas;
