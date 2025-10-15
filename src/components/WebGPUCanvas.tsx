import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    rendererRef: React.MutableRefObject<Renderer | null>;
    setMousePosition: (pos: { x: number, y: number }) => void;
    setIsMouseDown: (down: boolean) => void;
    isMouseDown: boolean;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ rendererRef, setMousePosition, setIsMouseDown, isMouseDown }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const lastMouseAddTime = useRef(0);
    const videoRef = useRef<HTMLVideoElement | null>(null); // Keep video ref for potential future use

    useEffect(() => {
        if (!canvasRef.current || rendererRef.current) return;
        const renderer = new Renderer(canvasRef.current);
        (async () => {
            const success = await renderer.init();
            if (success) {
                rendererRef.current = renderer;
                renderer.loadEffect('https://glsl.1ink.us/effects/liquid.wgsl', 'compute'); 
            }
        })();
        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, [rendererRef]); 
    
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active || !rendererRef.current) return;
            rendererRef.current.render(); 
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { 
            active = false; 
            cancelAnimationFrame(animationFrameId.current); 
        };
    }, [rendererRef]);

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
        updateMousePosition(event);
        addRippleAtMouseEvent(event);
    };

    const handleMouseUp = () => setIsMouseDown(false);

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        updateMousePosition(event);
        if (isMouseDown) {
            const now = performance.now();
            if (now - lastMouseAddTime.current < 50) return; // small delay to prevent too many points
            lastMouseAddTime.current = now;
            addRippleAtMouseEvent(event);
        }
    };

   return (
        <canvas 
            ref={canvasRef} 
            width="1280" 
            height="1280" 
            onMouseMove={handleCanvasMouseMove} 
            onMouseDown={handleMouseDown} 
            onMouseUp={handleMouseUp} 
            onMouseLeave={handleMouseLeave} 
        />
    );
};

export default WebGPUCanvas;
