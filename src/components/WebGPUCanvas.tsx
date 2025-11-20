import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    source?: CanvasImageSource | null;
    heading?: number;
    pitch?: number;
    zoom?: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, source, heading, pitch, zoom }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);
        
        (async () => {
            const success = await renderer.init();
            if (success) {
                rendererRef.current = renderer;
            }
        })();
        
        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, []);
    
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current && source) {
                rendererRef.current.renderStreetView(mode, source, heading, pitch, zoom);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { 
            active = false; 
            cancelAnimationFrame(animationFrameId.current); 
        };
    }, [mode, source, heading, pitch, zoom]);

    return (
        <canvas 
            ref={canvasRef} 
            width="1280" 
            height="1280"
            style={{ 
                maxWidth: '100%', 
                height: 'auto',
                border: '2px solid #333'
            }}
        />
    );
};

export default WebGPUCanvas;
