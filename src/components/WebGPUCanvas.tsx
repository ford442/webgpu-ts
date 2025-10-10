import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    rendererRef: React.MutableRefObject<Renderer | null>;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ rendererRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);

    // This useEffect handles the main renderer setup
    useEffect(() => {
        if (!canvasRef.current || rendererRef.current) return;
        const renderer = new Renderer(canvasRef.current);
        renderer.init().then(success => {
            if (success) {
                rendererRef.current = renderer;
            }
        });
    }, [rendererRef]);
    
    // This useEffect handles the animation loop
    useEffect(() => {
        let active = true;
        let animationFrameId = 0;
        const animate = () => {
            if (!active) return;
            rendererRef.current?.render();
            animationFrameId = requestAnimationFrame(animate);
        };
        animate();
        return () => { 
            active = false; 
            cancelAnimationFrame(animationFrameId); 
        };
    }, [rendererRef]); 

    // --- FIX IS HERE: Manually add wheel listener with passive: false ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            rendererRef.current?.updateZoom(event.deltaY);
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [rendererRef]);

    const handleMouseDown = () => {
        isDragging.current = true;
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        rendererRef.current?.stopMouseDrag();
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (rendererRef.current && canvas) {
            const rect = canvas.getBoundingClientRect();
            rendererRef.current.updateMouse(
                event.clientX - rect.left,
                event.clientY - rect.top,
                isDragging.current
            );
        }
    };
    
    return (
        <canvas 
            ref={canvasRef} 
            width="1536"
            height="1536"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove} 
            onMouseLeave={handleMouseUp}
            // onWheel is now handled by the useEffect hook
        />
    );
};

export default WebGPUCanvas;
