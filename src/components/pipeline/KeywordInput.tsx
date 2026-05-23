"use client";

import { useState } from "react";
import type { Phase } from "./StepStrip";

interface KeywordInputProps {
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  maxResults: number;
  onMaxResultsChange: (n: number) => void;
  quality: string;
  onQualityChange: (q: string) => void;
  regionCode: string;
  onRegionCodeChange: (code: string) => void;
  regionOptions: ReadonlyArray<{ code: string; label: string }>;
  isRunning: boolean;
  onRun: () => void;
  onReset: () => void;
  onStop: () => void;
  phase: Phase;
  activeCount: number;
}

export default function KeywordInput({
  keywords,
  onKeywordsChange,
  maxResults,
  onMaxResultsChange,
  quality,
  onQualityChange,
  regionCode,
  onRegionCodeChange,
  regionOptions,
  isRunning,
  onRun,
  onReset,
  onStop,
  phase,
  activeCount,
}: KeywordInputProps) {
  const [kwInput, setKwInput] = useState("");

  const addKw = () => {
    const k = kwInput.trim();
    if (!k || keywords.includes(k)) return;
    onKeywordsChange([...keywords, k]);
    setKwInput("");
  };

  const removeKw = (k: string) => onKeywordsChange(keywords.filter((x) => x !== k));

  const runLabel =
    phase === "searching"
      ? "Searching…"
      : phase === "processing" || phase === "results"
        ? `Processing ${activeCount > 0 ? `(${activeCount} active)` : "…"}`
        : phase === "done" || phase === "stopped"
          ? "Run again"
          : "Run Pipeline";

  const handleRunClick = () => {
    if (phase === "done" || phase === "stopped") {
      onReset();
      return;
    }
    onRun();
  };

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
            disabled={isRunning}
          />
          <button className="btn add" onClick={addKw} disabled={isRunning || !kwInput.trim()}>
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
                <button className="tag-x" onClick={() => removeKw(k)} disabled={isRunning}>
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="cfg-run">
        <select
          className="sel"
          value={String(maxResults)}
          onChange={(e) => onMaxResultsChange(parseInt(e.target.value, 10))}
          disabled={isRunning}
        >
          {["2", "5", "8", "10", "20", "50"].map((v) => (
            <option key={v} value={v}>
              {v} videos / keyword
            </option>
          ))}
        </select>
        <select
          className="sel"
          value={regionCode}
          onChange={(e) => onRegionCodeChange(e.target.value)}
          disabled={isRunning}
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
          disabled={isRunning}
        >
          {["360p", "480p", "720p", "1080p"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <button
          className={`run-btn${isRunning ? " running" : ""}`}
          onClick={handleRunClick}
          disabled={isRunning || (phase !== "done" && phase !== "stopped" && keywords.length === 0)}
        >
          {runLabel}
        </button>
        {isRunning && (
          <button className="stop-btn" onClick={onStop}>
            ■ Stop
          </button>
        )}
      </div>
    </>
  );
}
