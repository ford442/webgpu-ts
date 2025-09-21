import React, { useRef, useEffect } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
    imageUrl: string;
    depthMap: any;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, imageVersion, imageUrl, depthMap }) => {
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

    // Load new images
    useEffect(() => {
        if (rendererRef.current && imageVersion > 0) {
            // --- FIX IS HERE ---
            // Changed the function call to the correct name: loadImage
            rendererRef.current.loadImage(imageUrl);
        }
    }, [imageVersion, imageUrl]);

    // Update the depth map when it's ready
    useEffect(() => {
        if (rendererRef.current && depthMap) {
            rendererRef.current.updateDepthMap(depthMap.predicted_depth.data, depthMap.predicted_depth.width, depthMap.predicted_depth.height);
        }
    }, [depthMap]);

    // Main render loop
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                // Pass a dummy video element for now as it's not used in depth mode
                rendererRef.current.render(mode, null as any, zoom, panX, panY);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY]);

    // Mouse move handler for parallax
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
