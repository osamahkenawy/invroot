import cron from 'node-cron';
import { query, execute } from './database.js';
import { sendPaymentReminder } from './email.js';

export function startScheduledJobs() {
  // Run every day at 8:00 AM UTC
  cron.schedule('0 8 * * *', async () => {
    console.log('[Cron] Running daily jobs...');
    await processOverdueInvoices();
    await processRecurringBilling();
    await sendScheduledReminders();
  });

  // Run every hour to process webhooks / retry failures
  cron.schedule('0 * * * *', async () => {
    await retryFailedWebhooks();
  });

  console.log('✅ Scheduled jobs initialized');
}

async function processOverdueInvoices() {
  try {
    const updated = await execute(
      `UPDATE invoices SET status = 'overdue'
       WHERE status = 'sent' AND due_date < CURDATE()`,
    );
    if (updated.affectedRows > 0) {
      console.log(`[Cron] Marked ${updated.affectedRows} invoice(s) as overdue`);
    }
  } catch (err) {
    console.error('[Cron] processOverdueInvoices error:', err.message);
  }
}

async function sendScheduledReminders() {
  try {
    // Find active reminder rules and match them to due/overdue invoices
    const rules = await query(`
      SELECT rr.*, t.id as tenant_id
      FROM reminder_rules rr
      JOIN tenants t ON rr.tenant_id = t.id
      WHERE t.status = 'active' AND rr.is_active = 1
    `);

    for (const rule of rules) {
      const targetDate = rule.days_offset >= 0
        ? `DATE_ADD(CURDATE(), INTERVAL ${rule.days_offset} DAY)`
        : `DATE_SUB(CURDATE(), INTERVAL ${Math.abs(rule.days_offset)} DAY)`;

      const invoices = await query(`
        SELECT i.*, c.email as client_email, c.name as client_name, c.preferred_language
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        WHERE i.tenant_id = ? AND i.due_date = ${targetDate}
          AND i.status IN ('sent', 'overdue')
          AND i.id NOT IN (
            SELECT entity_id FROM reminder_logs
            WHERE rule_id = ? AND DATE(sent_at) = CURDATE()
          )
      `, [rule.tenant_id, rule.id]);

      for (const inv of invoices) {
        try {
          if (rule.channel === 'email' || rule.channel === 'both') {
            const daysOverdue = rule.days_offset < 0 ? Math.abs(rule.days_offset) : 0;
            await sendPaymentReminder({
              to: inv.client_email,
              clientName: inv.client_name,
              invoiceNumber: inv.invoice_number,
              amount: inv.total_amount,
              currency: inv.currency,
              dueDate: inv.due_date,
              daysOverdue,
              lang: inv.preferred_language || 'en',
            });
            await execute(
              `INSERT INTO reminder_logs (tenant_id, rule_id, entity_id, channel, status) VALUES (?, ?, ?, ?, 'sent')`,
              [rule.tenant_id, rule.id, inv.id, 'email']
            );
          }
        } catch (err) {
          console.error(`[Cron] Reminder failed for invoice ${inv.id}:`, err.message);
          await execute(
            `INSERT INTO reminder_logs (tenant_id, rule_id, entity_id, channel, status, error) VALUES (?, ?, ?, ?, 'failed', ?)`,
            [rule.tenant_id, rule.id, inv.id, 'email', err.message]
          );
        }
      }
    }
  } catch (err) {
    console.error('[Cron] sendScheduledReminders error:', err.message);
  }
}

async function processRecurringBilling() {
  try {
    const schedules = await query(`
      SELECT rs.*, t.id as tenant_id
      FROM recurring_schedules rs
      JOIN tenants t ON rs.tenant_id = t.id
      WHERE rs.status = 'active'
        AND rs.next_billing_date <= CURDATE()
        AND (rs.end_date IS NULL OR rs.end_date >= CURDATE())
    `);

    for (const schedule of schedules) {
      try {
        // Generate invoice from schedule
        await execute(`
          INSERT INTO invoices (
            tenant_id, client_id, recurring_schedule_id, invoice_number, status,
            issue_date, due_date, currency, subtotal, tax_amount, total_amount,
            line_items, notes
          ) SELECT
            tenant_id, client_id, id, CONCAT('REC-', LPAD(FLOOR(RAND()*99999), 5,'0')),
            'draft', CURDATE(),
            DATE_ADD(CURDATE(), INTERVAL payment_terms DAY),
            currency, subtotal, tax_amount, total_amount, line_items, notes
          FROM recurring_schedules WHERE id = ?
        `, [schedule.id]);

        // Update next billing date
        let interval = 'MONTH';
        if (schedule.frequency === 'weekly') interval = 'WEEK';
        else if (schedule.frequency === 'quarterly') interval = 'QUARTER';
        else if (schedule.frequency === 'annual') interval = 'YEAR';

        await execute(
          `UPDATE recurring_schedules SET next_billing_date = DATE_ADD(next_billing_date, INTERVAL 1 ${interval}) WHERE id = ?`,
          [schedule.id]
        );
      } catch (err) {
        console.error(`[Cron] Recurring billing error for schedule ${schedule.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Cron] processRecurringBilling error:', err.message);
  }
}

async function retryFailedWebhooks() {
  try {
    const pending = await query(`
      SELECT * FROM webhook_deliveries
      WHERE status = 'failed' AND attempts < 5
        AND next_retry_at <= NOW()
    `);

    const { dispatchWebhook } = await import('./webhook-dispatcher.js');
    for (const delivery of pending) {
      await dispatchWebhook(delivery);
    }
  } catch (err) {
    console.error('[Cron] retryFailedWebhooks error:', err.message);
  }
}
