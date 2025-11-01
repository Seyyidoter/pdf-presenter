"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/** pdf.js (browser-only) — worker'ı self-host ediyoruz: public/pdf.worker.min.mjs */
let _pdfjs: typeof import("pdfjs-dist") | null = null;
async function ensurePdfjs() {
  if (_pdfjs) return _pdfjs;
  const m = await import("pdfjs-dist");
  m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  _pdfjs = m;
  return m;
}

/** Küçük yardımcılar */
function useResizeObserver<T extends HTMLElement>(cb: (entry: DOMRectReadOnly) => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) cb(e.contentRect);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [cb]);
  return ref;
}

function useIntersection<T extends Element>(
  ref: React.RefObject<T | null>,
  rootMargin = "400px"
) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setVisible(e.isIntersecting)),
      { root: null, rootMargin, threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return visible;
}

/** Tek sayfa renderer (canvas) */
function PageCanvas({
  pdf,
  pageNumber,
  fitWidth,
  zoom,
  dpr,
}: {
  pdf: any;
  pageNumber: number;
  fitWidth: number; // container genişliği
  zoom: number;     // 1.0 = normal
  dpr: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visible = useIntersection<HTMLDivElement>(holderRef);
  const [pageSize, setPageSize] = useState<{ wCSS: number; hCSS: number }>({ wCSS: 0, hCSS: 0 });

  const renderPage = useCallback(async () => {
    if (!visible || !canvasRef.current) return;
    const page = await pdf.getPage(pageNumber);

    // 1x ölçekle viewport al, sonra fit width'e göre ölçek hesapla
    const vp1 = page.getViewport({ scale: 1 });
    const baseScale = Math.max(0.1, fitWidth / vp1.width);
    const scale = baseScale * zoom;

    const vp = page.getViewport({ scale });

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Retina için fiziksel boyut
    const width = Math.floor(vp.width * dpr);
    const height = Math.floor(vp.height * dpr);
    canvas.width = width;
    canvas.height = height;

    // CSS boyut (ekranda görünen)
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    setPageSize({ wCSS: Math.floor(vp.width), hCSS: Math.floor(vp.height) });

    const transform = [dpr, 0, 0, dpr, 0, 0] as any;
    await page.render({ canvasContext: context, viewport: vp, transform }).promise;
  }, [pdf, pageNumber, fitWidth, zoom, dpr, visible]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  return (
    <div ref={holderRef} className="mx-auto my-6 w-full max-w-full">
      <div
        className="mx-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200"
        style={{ width: pageSize.wCSS || fitWidth, overflow: "hidden" }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}

/** Ana sayfa: PDF sayfalarını site içinde kaydırılabilir canvaslar olarak gösterir */
export default function PDFViewerPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Henüz dosya seçilmedi.");
  const [isBusy, setIsBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  const [zoom, setZoom] = useState(1); // 1.0 = normal
  const containerRef = useResizeObserver<HTMLDivElement>((rect) => {
    setContainerWidth(Math.min(1200, rect.width)); // üst limit
  });
  const [containerWidth, setContainerWidth] = useState<number>(900);

  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const handlePick = useCallback(() => inputRef.current?.click(), []);

  const loadFile = useCallback(async (file: File) => {
    if (!file) return;
    // eski blob'u bırak
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const localUrl = URL.createObjectURL(file);
    setPdfUrl(localUrl);

    setIsBusy(true);
    setStatus("PDF yükleniyor…");
    setFileName(file.name);
    setPdfDoc(null);
    setNumPages(0);

    try {
      const pdfjsLib = await ensurePdfjs();
      const buf = await file.arrayBuffer();
      const task = pdfjsLib.getDocument({ data: buf });
      const pdf = await task.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setStatus(`Yüklendi: ${pdf.numPages} sayfa`);
    } catch (e) {
      console.error(e);
      setStatus("Hata: PDF yüklenemedi.");
    } finally {
      setIsBusy(false);
    }
  }, [pdfUrl]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  }, [loadFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") loadFile(f);
  }, [loadFile]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);

  const handleClear = useCallback(() => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
    setPdfDoc(null);
    setNumPages(0);
    setFileName(null);
    setStatus("Temizlendi. Yeni bir PDF yükleyin.");
  }, [pdfUrl]);

  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))), []);
  const zoomIn  = useCallback(() => setZoom((z) => Math.min(3,   +(z + 0.1).toFixed(2))), []);
  const fitWidth = useCallback(() => setZoom(1), []);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="mx-auto max-w-6xl px-4 py-10" ref={containerRef}>
        <header className="mb-6">
          <h1 className="text-3xl font-bold">PDF Görüntüleyici (Siteyle Bütünleşik)</h1>
          <p className="mt-2 text-sm text-gray-600">
            PDF sayfaları, canvas olarak sitenin içinde render edilir. Kaydırdıkça sayfalar yüklenir.
          </p>
        </header>

        {/* Dropzone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 text-center shadow-sm"
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={onInputChange}
            className="hidden"
          />
          <motion.div initial={{ opacity: 0.9 }} animate={{ opacity: 1 }}>
            <p className="mb-3 text-sm text-gray-600">PDF'yi buraya sürükleyip bırakın</p>
            <button
              onClick={handlePick}
              className="rounded-2xl bg-black px-4 py-2 text-white shadow hover:opacity-90"
              disabled={isBusy}
            >
              Dosya Seç
            </button>
            <p className="mt-3 text-xs text-gray-500">{status}</p>
            {fileName && (
              <p className="mt-1 text-xs text-gray-500">
                Seçili dosya: <strong>{fileName}</strong>
              </p>
            )}
          </motion.div>
        </div>

        {/* Toolbar */}
        {pdfDoc && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600">Görünüm:</span>
            <button onClick={zoomOut} className="rounded-xl bg-white px-3 py-2 shadow ring-1 ring-gray-200 hover:bg-gray-50">–</button>
            <button onClick={fitWidth} className="rounded-xl bg-white px-3 py-2 shadow ring-1 ring-gray-200 hover:bg-gray-50">Fit Width</button>
            <button onClick={zoomIn} className="rounded-xl bg-white px-3 py-2 shadow ring-1 ring-gray-200 hover:bg-gray-50">+</button>
            <span className="ml-2 text-sm text-gray-500">Zoom: {(zoom*100).toFixed(0)}%</span>
            <div className="ml-auto text-sm text-gray-500">Sayfa: {numPages}</div>
            <button onClick={handleClear} className="rounded-xl bg-white px-3 py-2 shadow ring-1 ring-gray-200 hover:bg-gray-50">
              Temizle
            </button>
          </div>
        )}

        {/* Pages */}
        {pdfDoc && (
          <div className="mx-auto mt-6 w-full">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <PageCanvas
                key={p}
                pdf={pdfDoc}
                pageNumber={p}
                fitWidth={containerWidth - 16} // iç boşluk payı
                zoom={zoom}
                dpr={dpr}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
