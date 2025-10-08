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
    depthThreshold: number; // Add this line
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({ mode, zoom, panX, panY, rendererRef, farthestPoint, depthThreshold }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);

        const initRenderer = async () => {
            const success = await renderer.init();
            if (success) {
                if (rendererRef && 'current' in rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }

                // --- NEW: Set up the ResizeObserver after initialization ---
                const observer = new ResizeObserver(entries => {
                    for (const entry of entries) {
                        const canvas = entry.target as HTMLCanvasElement;
                        const width = entry.contentBoxSize[0].inlineSize;
                        const height = entry.contentBoxSize[0].blockSize;
                        // Call our new resize handler
                        renderer.handleResize(width, height);
                    }
                });
                observer.observe(canvas);
            }
        };

        initRenderer();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
            // If you want to disconnect the observer when the component unmounts:
            // observer.disconnect();
        };
    }, [rendererRef]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                rendererRef.current.render(mode, zoom, panX, panY, farthestPoint, depthThreshold);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, zoom, panX, panY, farthestPoint, depthThreshold, rendererRef]); // Add depthThreshold to dependency array

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
