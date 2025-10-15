import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    onReady: (renderer: Renderer) => void;
    setMousePosition: (pos: { x: number, y: number }) => void;
    setIsMouseDown: (down: boolean) => void;
    isMouseDown: boolean;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ onReady, setMousePosition, setIsMouseDown, isMouseDown }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const lastMouseAddTime = useRef(0);
    const rendererRef = useRef<Renderer | null>(null); // Internal ref for animation and events

    // Effect for initializing the renderer
    useEffect(() => {
        if (!canvasRef.current) return;
        
        const renderer = new Renderer(canvasRef.current);
        let isCancelled = false;

        (async () => {
            const success = await renderer.init();
            if (success && !isCancelled) {
                rendererRef.current = renderer; // Set internal ref
                onReady(renderer);              // Notify parent that the renderer is ready
            }
        })();

        return () => {
            isCancelled = true;
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, [onReady]); 
    
    // Effect for running the animation loop
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
    }, []); // Runs once after mount and uses the internal ref

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
        if (!rendererRef.current) return; // Use internal ref
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
