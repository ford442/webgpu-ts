import React, { useEffect, useRef } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
}

const fenway = { lat: 39.2575004, lng: -121.021821 };

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        // Load Google Maps JS API
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.onload = () => {
            if (window.google && window.google.maps) {
                const panorama = new window.google.maps.StreetViewPanorama(
                    panoRef.current!,
                    {
                        position: fenway,
                        pov: { heading: 34, pitch: 10 },
                        visible: true,
                    }
                );
                // Wait for the panorama to render and extract the canvas
                const tryFindCanvas = () => {
                    if (!panoRef.current) return;
                    // Google creates a canvas inside the panorama div
                    const canvases = panoRef.current.getElementsByTagName('canvas');
                    if (canvases.length > 0) {
                        canvasRef.current = canvases[0];
                        onCanvasReady(canvases[0]);
                    } else {
                        setTimeout(tryFindCanvas, 500);
                    }
                };
                tryFindCanvas();
            }
        };
        document.body.appendChild(script);
        return () => {
            document.body.removeChild(script);
        };
    }, [apiKey, onCanvasReady]);

    return <div ref={panoRef} style={{ width: '100%', height: '100%' }} />;
};

export default StreetView;

