import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getItemBySku } from '../api/items';
import { X, ScanLine, Camera, CameraOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface ScanLookupModalProps {
  onClose: () => void;
}

export default function ScanLookupModal({ onClose }: ScanLookupModalProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [isLooking, setIsLooking] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  // Auto-focus so a keyboard-wedge scanner's keystrokes land here
  // immediately without the person needing to click into the field first.
  useEffect(() => {
    inputRef.current?.focus();
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    if (scanTimerRef.current !== null) window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const startCamera = async () => {
    setCameraError('');
    const BarcodeDetectorCtor = (window as typeof window & { BarcodeDetector?: new (options?: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera barcode scanning is not supported here. Use a scanner or enter the SKU.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setCameraOpen(true);
      const detector = new BarcodeDetectorCtor({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      scanTimerRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;
        const results = await detector.detect(video).catch(() => []);
        const value = results.find((result) => result.rawValue)?.rawValue;
        if (value) {
          setCode(value);
          stopCamera();
          void lookup(value);
        }
      }, 250);
    } catch {
      setCameraError('Unable to access the camera. Check browser permissions or use manual entry.');
    }
  };

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play();
    }
  }, [cameraOpen]);

  const lookup = async (value: string) => {
    if (!value.trim()) return;
    setIsLooking(true);
    try {
      const item = await getItemBySku(value.trim());
      showToast(`Found "${item.name}"`);
      navigate(`/inventory/${item.id}`);
      onClose();
    } catch (err: any) {
      showToast(err?.message || `No item found for code "${value}"`, 'error');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setIsLooking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setIsLooking(true);
    await lookup(code);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-md p-6 w-[420px] mobile-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-section-header font-ui font-semibold flex items-center gap-2">
            <ScanLine size={18} className="text-accent" />
            Scan or Enter Code
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          Scan an item's barcode/QR label with a scanner, or type its SKU and press Enter.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SKU or scanned code..."
            disabled={isLooking}
            className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2.5 text-text-primary text-sm focus:outline-none focus:border-accent font-mono disabled:opacity-50"
          />
        </form>
        <div className="mt-3 flex gap-2"><button type="button" onClick={cameraOpen ? stopCamera : startCamera} className="inline-flex items-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm text-sm text-text-secondary hover:text-text-primary">{cameraOpen ? <CameraOff size={15} /> : <Camera size={15} />}{cameraOpen ? 'Stop camera' : 'Use camera'}</button></div>
        {cameraOpen && <div className="mt-3 overflow-hidden rounded-sm border border-border bg-black"><video ref={videoRef} muted playsInline className="w-full aspect-video object-cover" /></div>}
        {cameraError && <p className="mt-3 text-xs text-status-danger">{cameraError}</p>}
      </div>
    </div>
  );
}
