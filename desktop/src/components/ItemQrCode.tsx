import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';

interface ItemQrCodeProps {
  sku: string;
  itemName: string;
}

export default function ItemQrCode({ sku, itemName }: ItemQrCodeProps) {
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=400,height=500');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head><title>${itemName} — ${sku}</title></head>
        <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;">
          <div id="qr-print-target"></div>
          <p style="margin-top:12px;font-size:14px;">${itemName}</p>
          <p style="margin-top:2px;font-size:12px;color:#666;font-family:monospace;">${sku}</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    // Re-render the QR code in the print window's own DOM since the
    // canvas/svg can't just be copied over as a string.
    const target = printWindow.document.getElementById('qr-print-target');
    if (target) {
      const svg = document.getElementById(`qr-code-${sku}`);
      if (svg) target.innerHTML = svg.outerHTML;
    }
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="p-2 bg-white rounded-sm">
        <QRCodeSVG id={`qr-code-${sku}`} value={sku} size={80} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-text-secondary">Scan to look up this item by SKU</p>
        <p className="text-xs text-text-secondary font-mono">{sku}</p>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 text-sm text-accent hover:underline text-left mt-1"
        >
          <Printer size={13} />
          Print label
        </button>
      </div>
    </div>
  );
}
