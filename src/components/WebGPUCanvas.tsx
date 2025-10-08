import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    rendererRef: React.MutableRefObject<Renderer | null>;
    farthestPoint: { x: number; y: number };
    depthThreshold: number;
    edgeHardness: number;
    imageDimensions: { width: number; height: number };
    depthLevels: number;
    depthDimensions: { width: number; height: number }; // Add the missing prop
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({
    mode,
    rendererRef,
    farthestPoint,
    depthThreshold,
    edgeHardness,
    imageDimensions,
    depthLevels,
    depthDimensions // Add to destructuring
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

    // This useEffect for initialization is correct and does not need changes
    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (!container) return;
        const renderer = new Renderer(canvas);

        const initRenderer = async () => {
            const success = await renderer.init();
            if (success) {
                if (rendererRef && 'current' in rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                renderer.handleResize(); // Initial resize
                const observer = new ResizeObserver(() => renderer.handleResize());
                observer.observe(container);
            }
        };
        initRenderer();
        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [rendererRef]);

    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (rendererRef.current) {
                // Update the render call to include depthDimensions
                rendererRef.current.render(mode, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels, depthDimensions);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    // Update the dependency array
    }, [mode, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels, depthDimensions, rendererRef]);

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
