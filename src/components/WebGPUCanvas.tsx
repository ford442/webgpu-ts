import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    rendererRef: React.MutableRefObject<Renderer | null>;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ rendererRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (rendererRef.current && canvas) {
            const rect = canvas.getBoundingClientRect();
            rendererRef.current.updateMouse(
                (event.clientX - rect.left) / rect.width,
                (event.clientY - rect.top) / rect.height
            );
        }
    };

    return <canvas ref={canvasRef} width="800" height="600" onMouseMove={handleMouseMove} />;
};

export default WebGPUCanvas;
