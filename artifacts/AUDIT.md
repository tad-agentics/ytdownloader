# YTDownloader — Codebase Audit

**Date:** 2026-05-23 (updated after gap patches)  
**References:**
- `artifacts/ytdownloader-cursor-poc.md` — implementation spec
- `artifacts/ytdownloader-dashboard.jsx` — UI prototype / interaction model

---

## Summary (post-patch)

| Area | Status |
|------|--------|
| Backend pipeline | ✅ Complete |
| API routes | ✅ Complete |
| Dashboard layout & styling | ✅ Complete |
| Dashboard behavior | ✅ Patched (Run again, stop polling, results phase, progress animation) |
| File structure | ✅ `src/` layout documented; Tailwind scaffold removed |
| Design tokens | ✅ Wired via `cssRootBlock()` in layout |
| Deployment | ⬜ Dockerfile present; Cloud Run not tested in CI |

**All audit gaps have been addressed in code.** Deployment verification remains manual.

---

## Gaps patched (2026-05-23)

| Gap | Fix |
|-----|-----|
| Run again re-ran immediately | `KeywordInput` calls `onReset()` → clears videos, phase `input` |
| Stop halted polling early | Separate `isPolling` state; polls until all jobs terminal |
| Skipped `results` phase | 400ms `results` transition when videos first appear |
| Static card progress | 120ms interval animates downloading/uploading bars |
| `design-tokens.ts` unused | `cssRootBlock()` injected in `layout.tsx`; globals.css uses vars |
| Tailwind scaffold unused | Removed `tailwind.config.ts`, `postcss.config.mjs`, deps |
| Migration SQL drift | POC + docs SQL updated with `downloading`/`uploading` statuses |
| `currentJobIds` missing | Added `useState` + used in `handleStop` PATCH loop |
| Video card CSS gaps | Explicit `queued` border + `failed` progress bar styles |

---

## Artifacts

```
artifacts/
├── ytdownloader-cursor-poc.md
├── ytdownloader-dashboard.jsx
└── AUDIT.md
```

---

## File Structure — POC vs Repo

| POC path | Repo path | Status |
|----------|-----------|--------|
| `app/*` | `src/app/*` | ✅ intentional `src/` prefix |
| `lib/pipeline/*` | `src/lib/pipeline/*` | ✅ + `types.ts` |
| `lib/design-tokens.ts` | `src/lib/design-tokens.ts` | ✅ used by layout |
| `components/*` | `src/components/*` | ✅ |
| `supabase/migrations/*` | same | ✅ synced with repo migration |

---

## Remaining manual steps

1. Run Supabase migration if not already applied (includes `downloading`/`uploading` statuses)
2. Fill `.env.local` from `.env.local.example`
3. `docker build` + Cloud Run deploy per POC Phase 4
