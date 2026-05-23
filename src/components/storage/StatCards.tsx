interface StatCardsProps {
  downloaded: number;
  failed: number;
  successPct: number | null;
}

export default function StatCards({ downloaded, failed, successPct }: StatCardsProps) {
  return (
    <div className="stat-grid">
      <div className="sc gray">
        <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#444" strokeWidth="1.4" strokeLinecap="round">
          <path d="M15 3L27 9v12L15 27 3 21V9z" />
          <line x1="15" y1="3" x2="15" y2="27" />
          <line x1="3" y1="9" x2="27" y2="21" />
          <line x1="27" y1="9" x2="3" y2="21" />
        </svg>
        <div>
          <div className="sc-lbl">Downloaded</div>
          <div className="sc-val">{downloaded}</div>
        </div>
      </div>
      <div className="sc dark">
        <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#888" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="15" cy="15" r="10" />
          <line x1="15" y1="11" x2="15" y2="16" />
          <circle cx="15" cy="20" r=".8" fill="#888" />
        </svg>
        <div>
          <div className="sc-lbl">Failed</div>
          <div className="sc-val">{failed}</div>
        </div>
      </div>
      <div className="sc teal">
        <svg className="sc-ic" viewBox="0 0 30 30" fill="none" stroke="#1a5c60" strokeWidth="1.8" strokeLinecap="round">
          <polyline points="6,16 11,21 24,10" />
        </svg>
        <div>
          <div className="sc-lbl">Success</div>
          <div className="sc-val">{successPct !== null ? `${successPct}%` : "—"}</div>
        </div>
      </div>
    </div>
  );
}
