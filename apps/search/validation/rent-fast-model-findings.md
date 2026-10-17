# Alternative fast configuration diagnostic — 2026-10-17

This is an alternative configuration diagnostic, not acceptance of the current deployment. No product source, owner configuration, env files, or credentials were copied/changed. The existing configured model remains unchanged; GEMINI_MODEL_FAST was absent originally.

Official Gemini documentation describes `gemini-2.5-flash-lite` as stable and supporting structured outputs: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite . Authenticated ListModels returned HTTP200 and advertised `models/gemini-2.5-flash-lite`, version001, with generateContent support. Metadata evidence: `apps/search/validation/rent-fast-model-metadata.json`.

Native staged standalone server on127.0.0.1:3138 used an explicit temporary process-only GEMINI_MODEL_FAST=gemini-2.5-flash-lite override and eight sample fixture listings. Its first cold six-suite prompt attempted exactly one real generation request, which returned HTTP404. Actual parser was fallback in196ms; search completed in37ms with four sample results. Fallback preserved house/apartment OR, soft3–5k rent, hard10-minute bike target, and three-campus UofT ambiguity. These are fallback observations and do not establish any successful Gemini interpretation or the4-second Gemini latency gate.

Stopped the remaining five generation prompts after the definitive invalid-model response; no further models or external retries tried. The advertised metadata conflicts with generation availability. This cannot prove why the model was rejected; no provider error bodies were captured. The current main model's previous latency failure remains unresolved.

Resolver diagnostics retained known UofT St. George representative-point resolution and rejected the unresolved TD branch after MapTiler HTTP200. Native server stopped with exit143. Assert-based evidence assessment passed in `apps/search/validation/rent-fast-model-assess.mjs`. Full credential-free run: `apps/search/validation/rent-fast-model-acceptance.json`.

Not checked: six-prompt fast-model Gemini semantics/latency, live DB, C/D routing/enrichment, UI, or deployment. Risk: selecting this model based on ListModels alone silently uses basic fallback under the present provider availability.
