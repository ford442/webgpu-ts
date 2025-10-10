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
    isLoading: boolean; // Add this prop
    onReady: () => void;   // Add this prop
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, rendererRef, farthestPoint, mousePosition, setMousePosition, isMouseDown, setIsMouseDown, isLoading, onReady }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);
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
                // Tell the App component that the renderer is initialized and ready
                onReady(); 
            }
        })();
        return () => cancelAnimationFrame(animationFrameId.current);
    }, [rendererRef, onReady]); 
    useEffect(() => {
        if (isLoading) {
            cancelAnimationFrame(animationFrameId.current);
            return;
        }
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current && videoRef.current) {
                rendererRef.current.render(mode, videoRef.current, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate(); // Start loop
        return () => { 
            active = false; 
            cancelAnimationFrame(animationFrameId.current); 
        };
    }, [isLoading, mode, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown, rendererRef]);

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

    const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        setIsMouseDown(true);
        updateMousePosition(event);
        if (rendererRef.current) {
            const canvas = canvasRef.current!;
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) / canvas.width;
            const y = (event.clientY - rect.top) / canvas.height;
            rendererRef.current.onPointerDown(x, y);
        }
    };

    const handleMouseUp = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        updateMousePosition(event);
    };

    return (
        <canvas ref={canvasRef} width="2048" height="2048" onMouseMove={handleCanvasMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
    );
};

export default WebGPUCanvas;
