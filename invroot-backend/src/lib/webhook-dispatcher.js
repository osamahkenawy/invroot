import { query, execute } from './database.js';

/**
 * Dispatch a webhook event to all registered endpoints for a tenant.
 */
export async function dispatchWebhookEvent({ tenantId, event, payload }) {
  const endpoints = await query(
    `SELECT * FROM webhook_endpoints WHERE tenant_id = ? AND is_active = 1 AND (events LIKE ? OR events LIKE '%"*"%')`,
    [tenantId, `%"${event}"%`]
  );

  for (const endpoint of endpoints) {
    await queueWebhookDelivery({ endpoint, event, payload });
  }
}

async function queueWebhookDelivery({ endpoint, event, payload }) {
  const deliveryId = await execute(
    `INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event, payload, status, attempts, next_retry_at)
     VALUES (?, ?, ?, ?, 'pending', 0, NOW())`,
    [endpoint.tenant_id, endpoint.id, event, JSON.stringify(payload)]
  );
  await dispatchWebhook({ id: deliveryId.insertId, ...endpoint, event, payload: JSON.stringify(payload) });
}

export async function dispatchWebhook(delivery) {
  const { id, url, secret, event, payload } = delivery;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

  const signature = generateSignature(body, secret);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Invroot-Event': event,
        'X-Invroot-Signature': signature,
        'X-Invroot-Delivery': String(id),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    await execute(
      `UPDATE webhook_deliveries
       SET status = ?, response_status = ?, attempts = attempts + 1, last_attempt_at = NOW(), next_retry_at = NULL
       WHERE id = ?`,
      [response.ok ? 'delivered' : 'failed', response.status, id]
    );
  } catch (err) {
    const nextRetry = new Date(Date.now() + 5 * 60 * 1000); // retry in 5 min
    await execute(
      `UPDATE webhook_deliveries
       SET status = 'failed', error = ?, attempts = attempts + 1, last_attempt_at = NOW(), next_retry_at = ?
       WHERE id = ?`,
      [err.message, nextRetry, id]
    );
  }
}

function generateSignature(body, secret) {
  if (!secret) return '';
  const { createHmac } = require('crypto');
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}
