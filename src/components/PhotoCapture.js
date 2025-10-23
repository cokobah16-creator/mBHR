import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useRef, useCallback } from 'react';
import { CameraIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
export function PhotoCapture({ onCapture, onCancel, currentPhoto }) {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [stream, setStream] = useState(null);
    const [preview, setPreview] = useState(currentPhoto || null);
    const [error, setError] = useState(null);
    const [cameraActive, setCameraActive] = useState(false);
    const startCamera = useCallback(async () => {
        setError(null);
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            });
            setStream(mediaStream);
            setCameraActive(true);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Camera access denied';
            setError(errorMsg);
            console.error('Camera error:', err);
        }
    }, []);
    const stopCamera = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
            setCameraActive(false);
        }
    }, [stream]);
    const capturePhoto = useCallback(() => {
        if (!videoRef.current || !canvasRef.current)
            return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const targetSize = 200;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return;
        const videoAspect = video.videoWidth / video.videoHeight;
        let sx = 0;
        let sy = 0;
        let sWidth = video.videoWidth;
        let sHeight = video.videoHeight;
        if (videoAspect > 1) {
            sWidth = video.videoHeight;
            sx = (video.videoWidth - sWidth) / 2;
        }
        else {
            sHeight = video.videoWidth;
            sy = (video.videoHeight - sHeight) / 2;
        }
        ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, targetSize, targetSize);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setPreview(dataUrl);
        stopCamera();
    }, [stopCamera]);
    const retakePhoto = () => {
        setPreview(null);
        startCamera();
    };
    const confirmPhoto = () => {
        if (preview) {
            onCapture(preview);
            stopCamera();
        }
    };
    const handleCancel = () => {
        stopCamera();
        onCancel();
    };
    React.useEffect(() => {
        return () => {
            stopCamera();
        };
    }, [stopCamera]);
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/75", children: _jsxs("div", { className: "relative w-full max-w-md bg-white rounded-lg shadow-xl p-6", children: [_jsx("button", { onClick: handleCancel, className: "absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600", children: _jsx(XMarkIcon, { className: "h-6 w-6" }) }), _jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: preview ? 'Photo Preview' : 'Capture Photo' }), error && (_jsx("div", { className: "mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm", children: error })), _jsxs("div", { className: "relative bg-gray-100 rounded-lg overflow-hidden mb-4", children: [preview ? (_jsx("img", { src: preview, alt: "Captured photo", className: "w-full h-64 object-cover" })) : cameraActive ? (_jsx("video", { ref: videoRef, autoPlay: true, playsInline: true, muted: true, className: "w-full h-64 object-cover" })) : (_jsxs("div", { className: "w-full h-64 flex flex-col items-center justify-center text-gray-400", children: [_jsx(CameraIcon, { className: "h-16 w-16 mb-2" }), _jsx("p", { className: "text-sm", children: "Click Start Camera to begin" })] })), _jsx("canvas", { ref: canvasRef, className: "hidden" })] }), _jsxs("div", { className: "flex gap-3", children: [!preview && !cameraActive && (_jsxs("button", { onClick: startCamera, className: "flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2", children: [_jsx(CameraIcon, { className: "h-5 w-5" }), "Start Camera"] })), cameraActive && !preview && (_jsx("button", { onClick: capturePhoto, className: "flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors", children: "Capture Photo" })), preview && (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: retakePhoto, className: "flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors flex items-center justify-center gap-2", children: [_jsx(ArrowPathIcon, { className: "h-5 w-5" }), "Retake"] }), _jsx("button", { onClick: confirmPhoto, className: "flex-1 px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors", children: "Use Photo" })] }))] }), _jsx("p", { className: "mt-3 text-xs text-gray-500 text-center", children: "Photos are compressed to 200x200px and stored locally" })] }) }));
}
