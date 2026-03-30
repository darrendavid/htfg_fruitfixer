---
name: Phase 6 OCR review requirements
description: User wants OCR extracted data reviewed via triage UI with field-level keep/remove and content editing
type: project
---

OCR extraction (Phase 6) should deduplicate across images before submitting to Claude — many images may show the same fruit/poster from different angles.

**Why:** 605 OCR candidates likely contain duplicates; sending all to Claude wastes tokens and creates conflicting records.

**How to apply:** Group candidates by plant_id and similarity before extraction. After extraction, pipe results into the existing Phase 5 Review UI with an "OCR Review" queue type that supports:
- Viewing the source image alongside extracted content
- Editing extracted text fields inline
- Flagging individual fields (key_facts, plant_associations, etc.) as Keep or Remove
- Flagging the entire OCR record for removal (reuse existing discard flow)
- The UI should reuse the Phase 5 triage UI patterns, not be a separate app
