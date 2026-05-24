"use client";

import { useState } from "react";

export const ONBOARDING_STORAGE_KEY = "ytdownloader-onboarding-v1";

const STEPS = [
  {
    title: "Add keywords & search",
    lead: "Start with what you want to find on YouTube.",
    points: [
      "Type a keyword and click Add — you can use several at once.",
      "Set region, quality, max length, and how many results per keyword.",
      "Click Search YouTube to fetch matching videos.",
    ],
  },
  {
    title: "Pick videos to download",
    lead: "You choose exactly which results get downloaded.",
    points: [
      "Every result starts selected — click a card to toggle it off.",
      "Use Select all or Clear selection to adjust quickly.",
      "Click Download N selected when you are ready.",
    ],
  },
  {
    title: "Download, store & share",
    lead: "Videos and transcripts land in Cloudflare R2.",
    points: [
      "Each stored video gets Video and Transcript links in Download history.",
      "The Storage panel shows bucket usage for the whole team.",
      "Everyone on this link shares the same history — cookies run on the server.",
    ],
  },
] as const;

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

export default function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  if (!open) return null;

  const handleComplete = () => {
    setStep(0);
    onComplete();
  };

  return (
    <div className="modal-overlay onboarding-overlay" role="presentation">
      <div
        className="modal-dialog onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="onboarding-header">
          <span className="onboarding-kicker">Welcome to YTDownloader</span>
          <div className="onboarding-steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={`onboarding-dot${i === step ? " active" : i < step ? " done" : ""}`} />
            ))}
          </div>
        </div>

        <div className="onboarding-step-num">
          Step {step + 1} of {STEPS.length}
        </div>
        <h2 id="onboarding-title" className="modal-title onboarding-title">
          {current.title}
        </h2>
        <p className="onboarding-lead">{current.lead}</p>
        <ul className="onboarding-list">
          {current.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>

        <div className="modal-actions onboarding-actions">
          <button type="button" className="modal-btn cancel onboarding-skip" onClick={handleComplete}>
            Skip tour
          </button>
          <div className="onboarding-nav">
            {step > 0 && (
              <button type="button" className="modal-btn cancel" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {isLast ? (
              <button type="button" className="modal-btn primary" onClick={handleComplete}>
                Get started
              </button>
            ) : (
              <button type="button" className="modal-btn primary" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
