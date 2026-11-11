"use client";
import { useId, useRef, useState } from "react";

export function PdfPicker({ label, file, onChange, disabled = false }: { label: string; file?: File; onChange(file?: File): void; disabled?: boolean }) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(""), [dragging, setDragging] = useState(false);
  function choose(files: File[]) {
    if (disabled) return;
    setDragging(false);
    const selected = files[0];
    const message = files.length !== 1 ? "Choose one PDF at a time." : !selected.name.toLowerCase().endsWith(".pdf") || (selected.type !== "" && selected.type !== "application/pdf") ? "Choose a PDF document (.pdf). Other file types are not supported." : selected.size > 5 * 1024 * 1024 ? "This PDF is too large. Choose a file of 5 MB or less." : selected.size === 0 ? "This PDF is empty. Choose another file." : "";
    setError(message); onChange(message ? undefined : selected);
  }
  return <section className="tw-stack" aria-label={label}>
    <input ref={input} id={id} className="tw-visually-hidden" tabIndex={-1} type="file" accept="application/pdf,.pdf" aria-label={label} aria-describedby={`${id}-help`} disabled={disabled} onChange={e => { if (e.target.files?.length) choose(Array.from(e.target.files)); e.target.value = ""; }} />
    <button type="button" className={`tw-dropzone${dragging ? " tw-dropzone-active" : ""}`} disabled={disabled} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); choose(Array.from(e.dataTransfer.files)); }} aria-describedby={`${id}-help`}>
      <strong>{label}</strong><span>{file ? file.name : "Drop a PDF here, or click to choose"}</span>
      {file && <span>{(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB · {file.type || "application/pdf"}</span>}
    </button>
    <p id={`${id}-help`} className="tw-muted">PDF only · up to 5 MB · Enter or Space to choose</p>
    {file && <button type="button" className="tw-ghost" disabled={disabled} onClick={() => { onChange(undefined); setError(""); }}>Remove {label}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
