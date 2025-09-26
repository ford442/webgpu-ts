import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    rendererRef: React.MutableRefObject<Renderer | null>;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ rendererRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);

    useEffect(() => {
        if (!canvasRef.current || rendererRef.current) return;
        const renderer = new Renderer(canvasRef.current);
        renderer.init().then(success => {
            if (success) {
                rendererRef.current = renderer;
            }
        });
    }, [rendererRef]);

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
    
    const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        rendererRef.current?.updateZoom(event.deltaY);
    };

    return (
        <canvas 
            ref={canvasRef} 
            width="800" 
            height="600" 
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove} 
            onMouseLeave={handleMouseUp} // Stop dragging if mouse leaves
            onWheel={handleWheel}
        />
    );
};

export default WebGPUCanvas;
