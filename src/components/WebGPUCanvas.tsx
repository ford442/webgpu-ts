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
    source?: CanvasImageSource | null; // NEW PROP
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, rendererRef, farthestPoint, mousePosition, setMousePosition, isMouseDown, setIsMouseDown, source }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        let keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
        let keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
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

                // Keyboard handlers for pinball flippers
                keyDownHandler = (e: KeyboardEvent) => {
                    if (!rendererRef.current) return;
                    if (e.code === 'ArrowLeft' || e.code === 'KeyA') rendererRef.current.setPinballFlipperState(true, false);
                    if (e.code === 'ArrowRight' || e.code === 'KeyD') rendererRef.current.setPinballFlipperState(false, true);
                };
                keyUpHandler = (e: KeyboardEvent) => {
                    if (!rendererRef.current) return;
                    if (e.code === 'ArrowLeft' || e.code === 'KeyA') rendererRef.current.setPinballFlipperState(false, false);
                    if (e.code === 'ArrowRight' || e.code === 'KeyD') rendererRef.current.setPinballFlipperState(false, false);
                };
                window.addEventListener('keydown', keyDownHandler);
                window.addEventListener('keyup', keyUpHandler);
            }
        })();
        return () => {
            cancelAnimationFrame(animationFrameId.current);
            if (keyDownHandler) window.removeEventListener('keydown', keyDownHandler as EventListener);
            if (keyUpHandler) window.removeEventListener('keyup', keyUpHandler as EventListener);
        };
    }, [rendererRef]);
    
 useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                // Use provided source (StreetView canvas) if available, else fallback to video
                const inputSource = source || videoRef.current;
                if (inputSource) {
                    rendererRef.current.render(mode, inputSource, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown);
                }
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY, farthestPoint, mousePosition, isMouseDown, rendererRef, source]);

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
        updateMousePosition(event); // Ensure position is updated on click
        // Streetview mode doesn't use ripple effects
    };

    const handleMouseUp = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        updateMousePosition(event);
        // Streetview mode doesn't use ripple effects
    };

   return (
        <canvas ref={canvasRef} width="1280" height="1280" onMouseMove={handleCanvasMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onMouseLeave={handleMouseLeave} />
    );
};

export default WebGPUCanvas;
