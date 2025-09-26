import React, { useRef, useEffect } from 'react';
import { Renderer, RenderMode } from '../renderer/Renderer';

// Define a clear type for our depth map data to be used as a prop.
interface DepthMapData {
    predicted_depth: {
        data: Float32Array;
        width: number;
        height: number;
    }
}

interface WebGPUCanvasProps {
    mode: RenderMode;
    zoom: number;
    panX: number;
    panY: number;
    imageVersion: number;
    imageUrl: string;
    depthMap: DepthMapData | null; // Use the specific type here
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
                rendererRef.current.render(mode);
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
