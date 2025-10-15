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
    depthDimensions: { width: number; height: number };
    fogColor: string;
    fogDensity: number;
    parallaxStrength: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = ({
    mode,
    rendererRef,
    farthestPoint,
    depthThreshold,
    edgeHardness,
    imageDimensions,
    depthLevels,
    depthDimensions,
    fogColor,
    fogDensity,
    parallaxStrength
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
                renderer.handleResize(); // Initial resize
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
                rendererRef.current.render(mode, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels, depthDimensions, fogColor, fogDensity, parallaxStrength);
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [mode, farthestPoint, depthThreshold, edgeHardness, imageDimensions, depthLevels, depthDimensions, fogColor, fogDensity, parallaxStrength, rendererRef]);

    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
