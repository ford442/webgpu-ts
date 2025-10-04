// src/components/WebGPUCanvas.tsx

import React, { useRef, useEffect, useState } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types'; // Corrected import path

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
    isPlaying: boolean;
    onVideoReady: (isReady: boolean) => void;
    liquidSource: 'image' | 'video';
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, imageVersion, isPlaying, onVideoReady, liquidSource }) => {
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
        rendererRef.current = renderer;

        let video: HTMLVideoElement | null = null;
        const handleCanPlay = () => onVideoReady(true);
        const handleError = () => onVideoReady(false);

        (async () => {
            const success = await renderer.init();
            if (success) {
                video = document.createElement('video');
                videoRef.current = video;
                video.src = 'https://test.1ink.us/webgputs/big_buck_bunny_720p_surround.mp4';
                video.crossOrigin = 'anonymous';
                video.muted = true;
                video.loop = true;
                video.playsInline = true;

                // --- FIX START: HIDE AND APPEND VIDEO TO DOM ---
                video.style.position = 'absolute';
                video.style.left = '-9999px';
                video.style.top = '-9999px';
                video.style.width = '1px';
                video.style.height = '1px';
                document.body.appendChild(video);
                // --- FIX END ---

                video.addEventListener('canplay', handleCanPlay);
                video.addEventListener('error', handleError);
            }
        })();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
            rendererRef.current?.destroy();
            if (video) {
                video.removeEventListener('canplay', handleCanPlay);
                video.removeEventListener('error', handleError);
                // --- FIX: CLEANUP VIDEO FROM DOM ---
                if (video.parentNode) {
                    video.parentNode.removeChild(video);
                }
            }
        };
    }, [onVideoReady]);

    useEffect(() => {
        if (rendererRef.current && imageVersion > 0) {
            rendererRef.current.loadRandomImage();
        }
    }, [imageVersion]);

    useEffect(() => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.play().catch(console.error);
            } else {
                videoRef.current.pause();
            }
        }
    }, [isPlaying]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current && videoRef.current) {
                rendererRef.current.render(mode, videoRef.current, zoom, panX, panY, liquidSource);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY, liquidSource]);

    const addRippleAtMouseEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!rendererRef.current) return;
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / canvas.width;
        const y = (event.clientY - rect.top) / canvas.height;
        rendererRef.current.addRipplePoint(x, y);
    };

    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        setIsMouseDown(true);
        if (mode === 'ripple' || mode === 'liquid' || mode === 'liquid-v1') {
            addRippleAtMouseEvent(event);
        }
    };

    const handleMouseUp = () => setIsMouseDown(false);
    const handleMouseLeave = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (isMouseDown && (mode === 'ripple' || mode === 'liquid' || mode === 'liquid-v1')) {
            const now = performance.now();
            if (now - lastMouseAddTime.current < 10) return;
            lastMouseAddTime.current = now;
            addRippleAtMouseEvent(event);
        }
    };

    return (
        <canvas ref={canvasRef} width="2048" height="2048" onMouseMove={handleCanvasMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
    );
};

export default WebGPUCanvas;
