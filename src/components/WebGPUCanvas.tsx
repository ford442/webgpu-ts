import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    rendererRef: React.MutableRefObject<Renderer | null>;
    farthestPoint: { x: number; y: number };
    mousePosition: { x: number; y: number };
    setMousePosition: (pos: { x: number, y: number }) => void;
    isMouseDown: boolean;
    setIsMouseDown: (down: boolean) => void;
    onInit?: () => void;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, rendererRef, farthestPoint, mousePosition, setMousePosition, isMouseDown, setIsMouseDown, onInit }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);
    const lastMouseAddTime = useRef(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        
        (async () => {
            const success = await renderer.init();
            if (success) {
                 if (rendererRef && 'current' in rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                videoRef.current = document.createElement('video');
                videoRef.current.src = 'https://test.1ink.us/webgputs/big_buck_bunny_720p_surround.mp4';
                videoRef.current.crossOrigin = 'anonymous';
                videoRef.current.muted = true;
                videoRef.current.loop = true;
                videoRef.current.autoplay = true;
                videoRef.current.playsInline = true;
                await videoRef.current.play().catch(console.error);
                if (onInit) onInit();
            }
        })();
        return () => cancelAnimationFrame(animationFrameId.current);
    }, [rendererRef, onInit]);
    
 useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current && videoRef.current) {
                // --- THIS IS THE CORRECTED LINE ---
                rendererRef.current.render(mode, videoRef.current, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown, rendererRef]); // Added isMouseDown and rendererRef

     const updateMousePosition = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / canvas.width;
        const y = (event.clientY - rect.top) / canvas.height;
        setMousePosition({ x, y });
    };

    const handleMouseLeave = () => {
        setIsMouseDown(false);
        setMousePosition({ x: -1, y: -1 });
    };
    
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
        updateMousePosition(event); // Ensure position is updated on click
        if (mode === 'ripple' || mode === 'liquid' || mode === 'liquid-viscous') {
            addRippleAtMouseEvent(event);
        }
    };

    const handleMouseUp = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        updateMousePosition(event);
        if (isMouseDown && (mode === 'ripple' || mode === 'liquid' || mode === 'liquid-viscous')) {
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
