// src/components/WebGPUCanvas.tsx

import React, { useRef, useEffect } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageUrl: string; // imageVersion is no longer needed
    depthMap: any;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, imageUrl, depthMap }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const animationFrameId = useRef<number>(0);
    
    // Setup the renderer
    useEffect(() => {
        if (!canvasRef.current) return;
        const renderer = new Renderer(canvasRef.current);
        renderer.init().then(success => {
            if (success) rendererRef.current = renderer;
        });
    }, []);

    // --- THIS IS THE CHANGE ---
    // Load a new image whenever the imageUrl prop changes.
    useEffect(() => {
        if (rendererRef.current && imageUrl) {
            rendererRef.current.loadImage(imageUrl);
        }
    }, [imageUrl]);

    // Update the depth map when it's ready
    useEffect(() => {
        if (rendererRef.current && depthMap) {
            rendererRef.current.updateDepthMap(depthMap.predicted_depth.data, depthMap.predicted_depth.width, depthMap.predicted_depth.height);
        }
    }, [depthMap]);

    // Main render loop (no changes here)
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                rendererRef.current.render(mode);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY]); 

    // Mouse move handler for parallax (no changes here)
    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (rendererRef.current && mode === 'depth') {
            const canvas = canvasRef.current!;
            const rect = canvas.getBoundingClientRect();
            const x = (event.clientX - rect.left) / canvas.width;
            const y = (event.clientY - rect.top) / canvas.height;
            rendererRef.current.updateMouse(x, y);
        }
    };

    return (
        <canvas ref={canvasRef} width="800" height="600" onMouseMove={handleCanvasMouseMove} />
    );
};

export default WebGPUCanvas;
