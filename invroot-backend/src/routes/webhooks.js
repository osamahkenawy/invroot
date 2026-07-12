import express from 'express';
const router = express.Router();
// Webhook delivery confirmation (external systems posting back)
router.post('/', (req, res) => res.json({ received: true }));
export default router;
