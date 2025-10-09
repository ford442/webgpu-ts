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
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({
    mode,
    rendererRef,
    farthestPoint,
    depthThreshold,
    edgeHardness,
    imageDimensions,
    depthLevels
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

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
                
                // --- FIXED: Call handleResize with no arguments ---
                renderer.handleResize();

                const observer = new ResizeObserver(entries => {
                    // --- FIXED: Call handleResize with no arguments ---
                    renderer.handleResize();
                });
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
                // The render call signature is correct from our previous fixes
                rendererRef.current.render(mode, 0, 0, 0, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels, rendererRef]);

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
