import React, { useEffect, useRef, useState } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
}

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey }) => {
    const panoRef = useRef<HTMLDivElement>(null);
    const [panorama, setPanorama] = useState<google.maps.StreetViewPanorama | null>(null);

    // Coordinates from your original HTML
    const startLocation = { lat: 39.2575004, lng: -121.021821 };

    useEffect(() => {
        // Check if Google Maps is already loaded
        if (!(window as any).google) {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=alpha`;
            script.async = true;
            script.defer = true;
            script.onload = initialize;
            document.body.appendChild(script);
        } else {
            initialize();
        }

        function initialize() {
            if (!panoRef.current) return;

            // Create a Map instance (required context for some StreetView features)
            // We create a detached div for it since we only care about the panorama
            const mapDiv = document.createElement('div');
            const mapInstance = new google.maps.Map(mapDiv, {
                center: startLocation,
                zoom: 12,
            });

            // Create the Panorama attached to our ref
            const panoInstance = new google.maps.StreetViewPanorama(panoRef.current!, {
                position: startLocation,
                pov: { heading: 34, pitch: 10 },
                zoom: 1,
                showRoadLabels: false,
                disableDefaultUI: true
            });

            mapInstance.setStreetView(panoInstance);
            setPanorama(panoInstance);

            // --- CRITICAL: Find the Canvas ---
            // Google Maps creates a <canvas> inside the container div. We poll until it exists.
            const checkForCanvas = setInterval(() => {
                if (panoRef.current) {
                    const canvases = panoRef.current.getElementsByTagName('canvas');
                    if (canvases.length > 0) {
                        const canvas = canvases[0];
                        // Ensure canvas has actual dimensions before using it
                        if (canvas.width > 0 && canvas.height > 0) {
                            console.log("StreetView Canvas Found!", canvas);
                            onCanvasReady(canvas);
                            clearInterval(checkForCanvas);
                        }
                    }
                }
            }, 500);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey /* onCanvasReady excluded to prevent re-init loops */]);

    // --- Navigation Logic ---
    const findNextPano = (links: google.maps.StreetViewLink[] | null, currentHeading: number) => {
        if (!links) return null;
        let closestHeadingDiff = 360;
        let closestPanoId = null;
        for (const link of links) {
            const headingDiff = Math.abs((link.heading || 0) - currentHeading);
            if (headingDiff < closestHeadingDiff) {
                closestHeadingDiff = headingDiff;
                closestPanoId = link.pano;
            }
        }
        return closestPanoId;
    };

    const handleMoveForward = () => {
        if (!panorama) return;
        const links = panorama.getLinks();
        const pov = panorama.getPov();
        const nextPanoId = findNextPano(links, pov.heading);
        if (nextPanoId) {
            panorama.setPano(nextPanoId);
        }
    };

    const handleZoomIn = () => panorama?.setZoom(panorama.getZoom() + 1);
    const handleZoomOut = () => panorama?.setZoom(panorama.getZoom() - 1);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* The actual StreetView div - Nearly invisible so WebGPU sees the update */}
            <div 
                ref={panoRef} 
                style={{ 
                    width: '100%', 
                    height: '100%', 
                    opacity: 0.01, 
                    pointerEvents: 'auto', 
                    position: 'absolute',
                    zIndex: 1
                }} 
            />

            {/* Custom Controls Overlay */}
            <div className="streetview-controls" style={{ 
                position: 'absolute', 
                bottom: 20, 
                left: '50%', 
                transform: 'translateX(-50%)', 
                zIndex: 100, 
                display: 'flex', 
                gap: 10 
            }}>
                <button onClick={handleMoveForward} style={btnStyle}>Forward</button>
                <button onClick={handleZoomIn} style={btnStyle}>Zoom In</button>
                <button onClick={handleZoomOut} style={btnStyle}>Zoom Out</button>
            </div>
        </div>
    );
};

const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    backgroundColor: 'gold',
    border: '2px solid white',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    color: 'black'
};

export default StreetView;
