import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

// This interface is now simplified to match what App.tsx provides
interface WebGPUCanvasProps {
    mode: RenderMode;
    rendererRef: React.MutableRefObject<Renderer | null>;
    onRendererReady: () => void;
    farthestPoint: { x: number; y: number };
    imageDimensions: { width: number; height: number };
    depthDimensions: { width: number; height: number };
    parallaxStrength: number;
}

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);

    // Effect for renderer initialization (no changes here)
    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const container = canvas.parentElement;
        if (!container) return;
        const renderer = new Renderer(canvas);

        const initRenderer = async () => {
            const success = await renderer.init();
            if (success) {
                if (props.rendererRef && 'current' in props.rendererRef) {
                    (props.rendererRef as React.MutableRefObject<Renderer | null>).current = renderer;
                }
                props.onRendererReady();
                
                const observer = new ResizeObserver(() => renderer.handleResize());
                observer.observe(container);
                renderer.handleResize();
            }
        };
        initRenderer();

        return () => {
            cancelAnimationFrame(animationFrameId.current);
        };
    }, [props.rendererRef, props.onRendererReady]);

    // Effect for the main animation loop
    useEffect(() => {
        let active = true;
        const animate = () => {
            if (!active) return;
            if (props.rendererRef.current) {
                // This call is now simplified to match the new Renderer.render signature
                props.rendererRef.current.render(
                    props.mode, 
                    props.farthestPoint,
                    props.imageDimensions, 
                    props.depthDimensions, 
                    props.parallaxStrength
                );
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [props]); // Reruns whenever any prop changes

    // We can remove the mouse handlers as they were for the parallax mesh mode
    return (
        <canvas ref={canvasRef} />
    );
};

export default WebGPUCanvas;
