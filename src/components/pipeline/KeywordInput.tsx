"use client";

import { useState } from "react";
import type { Phase } from "./StepStrip";

interface KeywordInputProps {
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  maxResults: number;
  onMaxResultsChange: (n: number) => void;
  maxDurationSeconds: number;
  onMaxDurationSecondsChange: (n: number) => void;
  maxDurationOptions: ReadonlyArray<{ seconds: number; label: string }>;
  quality: string;
  onQualityChange: (q: string) => void;
  regionCode: string;
  onRegionCodeChange: (code: string) => void;
  regionOptions: ReadonlyArray<{ code: string; label: string }>;
  isRunning: boolean;
  onSearch: () => void;
  onDownloadSelected: () => void;
  onReset: () => void;
  onStop: () => void;
  phase: Phase;
  activeCount: number;
  selectedCount: number;
}

export default function KeywordInput({
  keywords,
  onKeywordsChange,
  maxResults,
  onMaxResultsChange,
  maxDurationSeconds,
  onMaxDurationSecondsChange,
  maxDurationOptions,
  quality,
  onQualityChange,
  regionCode,
  onRegionCodeChange,
  regionOptions,
  isRunning,
  onSearch,
  onDownloadSelected,
  onReset,
  onStop,
  phase,
  activeCount,
  selectedCount,
}: KeywordInputProps) {
  const [kwInput, setKwInput] = useState("");

  const addKw = () => {
    const k = kwInput.trim();
    if (!k || keywords.includes(k)) return;
    onKeywordsChange([...keywords, k]);
    setKwInput("");
  };

  const removeKw = (k: string) => onKeywordsChange(keywords.filter((x) => x !== k));

  const primaryLabel =
    phase === "searching"
      ? "Searching…"
      : phase === "selecting"
        ? `Download ${selectedCount} selected`
        : phase === "processing"
          ? `Processing ${activeCount > 0 ? `(${activeCount} active)` : "…"}`
          : phase === "done" || phase === "stopped"
            ? "Search again"
            : "Search YouTube";

  const handlePrimaryClick = () => {
    if (phase === "done" || phase === "stopped") {
      onReset();
      return;
    }
    if (phase === "selecting") {
      onDownloadSelected();
      return;
    }
    onSearch();
  };

  const primaryDisabled =
    isRunning ||
    (phase === "selecting" && selectedCount === 0) ||
    (phase !== "selecting" && phase !== "done" && phase !== "stopped" && keywords.length === 0);

  return (
    <>
      <div className="kw-panel">
        <div className="kw-row">
          <input
            className="kw-inp"
            placeholder="Enter keyword… e.g. shopee affiliate vietnam"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addKw();
              if (e.key === "Backspace" && !kwInput && keywords.length) {
                onKeywordsChange(keywords.slice(0, -1));
              }
            }}
            disabled={isRunning || phase === "selecting"}
          />
          <button className="btn add" onClick={addKw} disabled={isRunning || phase === "selecting" || !kwInput.trim()}>
            Add
          </button>
        </div>
        <div className="tag-pool">
          {keywords.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--tx3)" }}>
              No keywords — type and press Enter or click Add
            </span>
          ) : (
            keywords.map((k) => (
              <div key={k} className="tag">
                {k}
                <button className="tag-x" onClick={() => removeKw(k)} disabled={isRunning || phase === "selecting"}>
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="cfg-run">
        <div className="cfg-controls">
          <select
            className="sel"
            value={String(maxResults)}
            onChange={(e) => onMaxResultsChange(parseInt(e.target.value, 10))}
            disabled={isRunning || phase === "selecting"}
          >
            {["2", "5", "8", "10", "20", "50"].map((v) => (
              <option key={v} value={v}>
                {v} videos / keyword
              </option>
            ))}
          </select>
          <select
            className="sel"
            value={String(maxDurationSeconds)}
            onChange={(e) => onMaxDurationSecondsChange(parseInt(e.target.value, 10))}
            disabled={isRunning || phase === "selecting"}
          >
            {maxDurationOptions.map(({ seconds, label }) => (
              <option key={seconds} value={seconds}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="sel"
            value={regionCode}
            onChange={(e) => onRegionCodeChange(e.target.value)}
            disabled={isRunning || phase === "selecting"}
          >
            {regionOptions.map(({ code, label }) => (
              <option key={code} value={code}>
                {code} · {label}
              </option>
            ))}
          </select>
          <select
            className="sel"
            value={quality}
            onChange={(e) => onQualityChange(e.target.value)}
            disabled={isRunning || phase === "selecting"}
          >
            {["360p", "480p", "720p", "1080p"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="cfg-actions">
          <button
            className={`run-btn${isRunning ? " running" : ""}`}
            onClick={handlePrimaryClick}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
          {phase === "selecting" && (
            <button className="stop-btn secondary" onClick={onReset}>
              Cancel
            </button>
          )}
          {phase === "processing" && (
            <button className="stop-btn" onClick={onStop}>
              ■ Stop
            </button>
          )}
        </div>
      </div>
    </>
  );
}
