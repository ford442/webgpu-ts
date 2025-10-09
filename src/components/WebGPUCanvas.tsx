import React, { useRef, useEffect } from 'react';
import { Renderer } from '../renderer/Renderer';
import { RenderMode } from '../renderer/types';

interface WebGPUCanvasProps {
    mode: RenderMode;
    rendererRef: React.MutableRefObject<Renderer | null>;
    onRendererReady: () => void;
    // Props for '3d-zoom' mode
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

const WebGPUCanvas: React.FC<WebGPUCanvasProps> = (props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>(0);
    const isDragging = useRef(false);

    // Effect for renderer initialization
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
                props.onRendererReady(); // Signal that the renderer is ready
                
                // Set up resize observer
                const observer = new ResizeObserver(() => renderer.handleResize());
                observer.observe(container);
                renderer.handleResize(); // Perform initial resize
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
                // Pass all props to the unified render method
                props.rendererRef.current.render(
                    props.mode, props.farthestPoint, props.depthThreshold,
                    props.edgeHardness, props.imageDimensions, props.depthLevels,
                    props.depthDimensions, props.fogColor, props.fogDensity, props.parallaxStrength
                );
            }
            animationFrameId.current = requestAnimationFrame(animate);
        };
        animate();
        return () => { active = false; cancelAnimationFrame(animationFrameId.current); };
    }, [props]); // Reruns whenever any prop changes

    // Effect for the '3d-parallax' mode's wheel listener
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (event: WheelEvent) => {
            if (props.mode === '3d-parallax') {
                event.preventDefault();
                props.rendererRef.current?.updateZoom(event.deltaY);
            }
        };
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [props.rendererRef, props.mode]);

    // Mouse handlers for the '3d-parallax' mode
    const handleMouseDown = () => {
        if (props.mode === '3d-parallax') isDragging.current = true;
    };
    const handleMouseUp = () => {
        if (props.mode === '3d-parallax') {
            isDragging.current = false;
            props.rendererRef.current?.stopMouseDrag();
        }
    };
    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (props.rendererRef.current && canvas && props.mode === '3d-parallax') {
            const rect = canvas.getBoundingClientRect();
            props.rendererRef.current.updateMouse(
                event.clientX - rect.left,
                event.clientY - rect.top,
                isDragging.current
            );
        }
    };

    return (
        <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseUp}
        />
    );
};

export default WebGPUCanvas;
