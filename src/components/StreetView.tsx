import React, { useEffect, useRef } from 'react';

interface StreetViewProps {
    onCanvasReady: (canvas: HTMLCanvasElement) => void;
    apiKey: string;
    onPanoramaReady?: (panorama: google.maps.StreetViewPanorama) => void;
}

const fenway = { lat: 39.2575004, lng: -121.021821 };

const StreetView: React.FC<StreetViewProps> = ({ onCanvasReady, apiKey, onPanoramaReady }) => {
    const panoRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // 1. Check if script exists to avoid duplicates
        if (document.querySelector('script[src*="maps.googleapis.com"]')) {
            initMap();
            return;
        }

        const script = document.createElement('script');
        // Use v=weekly and loading=async (though manual injection is still synchronous in nature)
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`;
        script.async = true;
        script.onload = () => initMap();
        document.body.appendChild(script);

        function initMap() {
            if (!window.google || !window.google.maps || !panoRef.current) return;

            const pano = new window.google.maps.StreetViewPanorama(
                panoRef.current,
                {
                    position: fenway,
                    pov: { heading: 34, pitch: 10 },
                    visible: true,
                    motionTracking: false,
                    motionTrackingControl: false,
                    disableDefaultUI: true
                }
            );

            if (onPanoramaReady) {
                onPanoramaReady(pano);
            }

            // 2. Robust Canvas Finder
            const findCanvas = setInterval(() => {
                if (!panoRef.current) { clearInterval(findCanvas); return; }
                
                const canvases = panoRef.current.getElementsByTagName('canvas');
                // Ensure canvas has actual dimensions before using it
                if (canvases.length > 0 &&Pkgs.mkShell {
    buildInputs = with pkgs; [
      cargo
      rustc
      rustfmt
      clippy
      libiconv
      libusb1
      udev
      pkg-config
      # Add other dependencies here
    ];

    # Set environment variables
    RUST_BACKTRACE = 1;
    RUST_LOG = "debug";
    PKG_CONFIG_PATH = "${pkgs.libusb1.dev}/lib/pkgconfig";
  }
<ctrl63>src/lib.rs
<ctrl62><ctrl60>pub mod connection;
pub mod errors;
pub mod messages;
pub mod utils;<ctrl61>
<ctrl63>src/errors.rs
use std::{fmt, io, str::Utf8Error};
use thiserror::Error;

/// Represents possible errors in the TTP233 driver.
#[derive(Error, Debug)]
pub enum TTP233Error {
    /// Device not found.
    #[error("TTP233 device not found")]
    DeviceNotFound,

    /// USB error.
    #[error("USB error: {0}")]
    UsbError(#[from] rusb::Error),

    /// I/O error.
    #[error("I/O error: {0}")]
    IoError(#[from] io::Error),

    /// UTF-8 error.
    #[error("UTF-8 decoding error: {0}")]
    Utf8Error(#[from] Utf8Error),

    /// Custom error message.
    #[error("{0}")]
    Custom(String),
}
<ctrl63>
