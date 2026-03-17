import { Router } from 'express';
import * as dal from '../lib/dal.js';

const router = Router();

// ── GET /api/ocr-review/next ────────────────────────────────────────────────
router.get('/next', (req, res) => {
  const userId = req.user!.id;
  const result = dal.getNextOcrItem(userId);

  if (!result) {
    res.json({ item: null, ocr: null, remaining: 0 });
    return;
  }

  const stats = dal.getOcrStats();
  res.json({ item: result.item, ocr: result.ocr, remaining: stats.pending });
});

// ── GET /api/ocr-review/stats ───────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  const stats = dal.getOcrStats();
  res.json({ stats });
});

// ── GET /api/ocr-review/:id ─────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return;
  }

  const ocr = dal.getOcrExtraction(id);
  if (!ocr) {
    res.status(404).json({ error: 'OCR extraction not found' });
    return;
  }

  res.json({ ocr });
});

// ── POST /api/ocr-review/:id/save ───────────────────────────────────────────
router.post('/:id/save', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return;
  }

  const { title, extracted_text, key_facts, plant_associations, source_context, reviewer_notes } = req.body ?? {};

  try {
    dal.updateOcrExtraction(id, {
      title: title !== undefined ? title : undefined,
      extracted_text: extracted_text !== undefined ? extracted_text : undefined,
      key_facts: key_facts !== undefined ? key_facts : undefined,
      plant_associations: plant_associations !== undefined ? plant_associations : undefined,
      source_context: source_context !== undefined ? source_context : undefined,
      reviewer_notes: reviewer_notes !== undefined ? reviewer_notes : undefined,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save' });
  }
});

// ── POST /api/ocr-review/:id/approve ────────────────────────────────────────
router.post('/:id/approve', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return;
  }

  // Apply any final edits before approving
  const { title, extracted_text, key_facts, plant_associations, source_context, reviewer_notes } = req.body ?? {};
  try {
    dal.updateOcrExtraction(id, {
      title: title !== undefined ? title : undefined,
      extracted_text: extracted_text !== undefined ? extracted_text : undefined,
      key_facts: key_facts !== undefined ? key_facts : undefined,
      plant_associations: plant_associations !== undefined ? plant_associations : undefined,
      source_context: source_context !== undefined ? source_context : undefined,
      reviewer_notes: reviewer_notes !== undefined ? reviewer_notes : undefined,
    });
    dal.approveOcrExtraction(id, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to approve' });
  }
});

// ── POST /api/ocr-review/:id/reject ─────────────────────────────────────────
router.post('/:id/reject', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'id must be an integer' });
    return;
  }

  try {
    dal.rejectOcrExtraction(id, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reject' });
  }
});

export default router;
