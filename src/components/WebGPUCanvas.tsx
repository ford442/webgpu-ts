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
    // --- ADD THE MISSING PROPS ---
    depthThreshold: number;
    edgeHardness: number;
    imageDimensions: { width: number; height: number }; // Added from previous step
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({
                                                       mode,
                                                       zoom,
                                                       panX,
                                                       panY,
                                                       rendererRef,
                                                       farthestPoint,
                                                       depthThreshold,
                                                       edgeHardness,
                                                       imageDimensions
                                                   }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

    useEffect(() => {
        // This useEffect for initialization can remain the same as the ResizeObserver version
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const renderer = new Renderer(canvas);

        const initRenderer = async () => {
            const success = await renderer.init();
            if (success) {
                if (rendererRef && 'current' in rendererRef) {
                    (rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                const initialWidth = canvas.clientWidth;
                const initialHeight = canvas.clientHeight;
                renderer.handleResize(initialWidth, initialHeight);

                const observer = new ResizeObserver(entries => {
                    for (const entry of entries) {
                        const canvas = entry.target as HTMLCanvasElement;
                        const width = entry.contentBoxSize[0].inlineSize;
                        const height = entry.contentBoxSize[0].blockSize;
                        renderer.handleResize(width, height);
                    }
                });
                observer.observe(canvas);
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
                // --- UPDATE THE RENDER CALL TO INCLUDE THE NEW PROPS ---
                rendererRef.current.render(mode, zoom, panX, panY, farthestPoint, depthThreshold, edgeHardness, imageDimensions);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
        // --- UPDATE THE DEPENDENCY ARRAY ---
    }, [mode, zoom, panX, panY, farthestPoint, depthThreshold, edgeHardness, imageDimensions, rendererRef]);

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;