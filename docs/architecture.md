# Architecture

Whereabout has two paths that share one model:

- **Hot path** — live guesses for uploaded photos. CPU inference (ONNX Runtime), about a second.
- **Cold path** — a daily job precomputes Atlas's answers for the Daily Five, so most visits
  never run a model at all.

```
Player ─► Next.js (globe, reveal animations, EXIF strip)
            │ REST / SSE / WebSocket
            ▼
        FastAPI gateway (rounds, scoring, rooms, uploads, rate limits)
            │                │                    │
          Redis         PostgreSQL + pgvector   Inference service (CPU)
     (rooms, cache)    (game data, ref index)   privacy gate → encoder →
                                                 geocells → kNN refine →
                                                 clue heads → heatmap
  Offline: ingestion workers · training (rented GPU) · daily builder · eval runner
```

## Atlas, the model (planned)

| Stage | Kind | Notes |
| --- | --- | --- |
| Privacy and scene gate | Pretrained detectors | Decline photos with people or indoor scenes |
| Image encoder | Pretrained CLIP-family ViT, fine-tuned | Specialized, not trained from scratch |
| Geocell classifier | Trained here | Distance-aware label smoothing over cells |
| Retrieval refinement | Built here | kNN over geotagged reference embeddings |
| Clue heads | Trained here | Labels derived from open maps by coordinates |
| Calibration | Trained here | Temperature scaling |

Design decisions are recorded in [`docs/decisions/`](decisions/).
