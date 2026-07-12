import express from 'express';
import { query } from '../lib/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

/* ── GET /api/reports/dashboard ─────────────────────── */
router.get('/dashboard', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const tid = req.tenantId;

    const [revenue] = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total_revenue,
              COALESCE(SUM(paid_amount), 0)  as total_collected,
              COUNT(*) as invoice_count
       FROM invoices WHERE tenant_id = ? AND status NOT IN ('void','draft') AND issue_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [tid, parseInt(period)]
    );
    const [outstanding] = await query(
      `SELECT COALESCE(SUM(total_amount - paid_amount), 0) as outstanding
       FROM invoices WHERE tenant_id = ? AND status IN ('sent','partial','overdue')`,
      [tid]
    );
    const [overdue] = await query(
      `SELECT COALESCE(SUM(total_amount - paid_amount), 0) as overdue_amount, COUNT(*) as overdue_count
       FROM invoices WHERE tenant_id = ? AND status = 'overdue'`,
      [tid]
    );

    // Receivables breakdown (current vs overdue)
    const [receivables] = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN status != 'overdue' THEN total_amount - paid_amount ELSE 0 END), 0) as current_amount,
        COALESCE(SUM(CASE WHEN status = 'overdue'  THEN total_amount - paid_amount ELSE 0 END), 0) as overdue_amount,
        COALESCE(SUM(total_amount - paid_amount), 0) as total_unpaid
       FROM invoices WHERE tenant_id = ? AND status IN ('sent','partial','overdue')`,
      [tid]
    );

    // Expenses / payables breakdown
    const [expenses] = await query(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses,
              COALESCE(SUM(CASE WHEN status = 'unpaid' THEN amount ELSE 0 END), 0) as unpaid_expenses,
              COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0) as overdue_expenses
       FROM expenses WHERE tenant_id = ?`,
      [tid]
    ).catch(() => [{ total_expenses: 0, unpaid_expenses: 0, overdue_expenses: 0 }]);

    // Cashflow summary (opening, incoming, outgoing for the period)
    const [cfSummary] = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN p.payment_date < DATE_SUB(CURDATE(), INTERVAL ? DAY) THEN p.amount ELSE 0 END), 0) as opening_cash,
        COALESCE(SUM(CASE WHEN p.payment_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) THEN p.amount ELSE 0 END), 0) as incoming
       FROM payments p WHERE p.tenant_id = ?`,
      [parseInt(period), parseInt(period), tid]
    ).catch(() => [{ opening_cash: 0, incoming: 0 }]);

    const [expenseOut] = await query(
      `SELECT COALESCE(SUM(amount), 0) as outgoing FROM expenses
       WHERE tenant_id = ? AND expense_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND status = 'paid'`,
      [tid, parseInt(period)]
    ).catch(() => [{ outgoing: 0 }]);

    const cashflow = await query(
      `SELECT DATE_FORMAT(issue_date, '%Y-%m-%d') as date,
              SUM(total_amount) as invoiced, SUM(paid_amount) as collected
       FROM invoices WHERE tenant_id = ? AND issue_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND status != 'void'
       GROUP BY DATE_FORMAT(issue_date, '%Y-%m-%d') ORDER BY date`,
      [tid, parseInt(period)]
    );

    const recent_invoices = await query(
      `SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount, i.due_date, i.status, i.currency,
              c.name as client_name
       FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
       WHERE i.tenant_id = ? AND i.status != 'void'
       ORDER BY i.created_at DESC LIMIT 8`,
      [tid]
    );

    // Recent expenses
    const recent_expenses = await query(
      `SELECT e.id, e.reference, e.amount, e.expense_date, e.status, e.category, e.vendor_name
       FROM expenses e WHERE e.tenant_id = ? ORDER BY e.expense_date DESC LIMIT 5`,
      [tid]
    ).catch(() => []);

    res.json({ success: true, data: {
      kpis: {
        total_revenue:    revenue.total_revenue,
        total_collected:  revenue.total_collected,
        invoice_count:    revenue.invoice_count,
        outstanding:      outstanding.outstanding,
        overdue_amount:   overdue.overdue_amount,
        overdue_count:    overdue.overdue_count,
      },
      receivables: {
        total:   receivables.total_unpaid,
        current: receivables.current_amount,
        overdue: receivables.overdue_amount,
      },
      payables: {
        total:   expenses.unpaid_expenses + expenses.overdue_expenses,
        current: expenses.unpaid_expenses,
        overdue: expenses.overdue_expenses,
      },
      cashflow_summary: {
        opening:  cfSummary.opening_cash,
        incoming: cfSummary.incoming,
        outgoing: expenseOut.outgoing,
        closing:  Number(cfSummary.opening_cash) + Number(cfSummary.incoming) - Number(expenseOut.outgoing),
      },
      cashflow,
      recent_invoices,
      recent_expenses,
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/reports/aging ─────────────────────────── */
router.get('/aging', async (req, res) => {
  try {
    const rows = await query(
      `SELECT
        c.name as client_name,
        SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 0 AND 30  THEN i.total_amount - i.paid_amount ELSE 0 END) AS d0_30,
        SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN i.total_amount - i.paid_amount ELSE 0 END) AS d31_60,
        SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN i.total_amount - i.paid_amount ELSE 0 END) AS d61_90,
        SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) > 90              THEN i.total_amount - i.paid_amount ELSE 0 END) AS d90plus,
        SUM(i.total_amount - i.paid_amount) as total_outstanding
       FROM invoices i JOIN clients c ON i.client_id = c.id
       WHERE i.tenant_id = ? AND i.status IN ('sent', 'partial', 'overdue')
       GROUP BY c.id, c.name HAVING total_outstanding > 0 ORDER BY total_outstanding DESC`,
      [req.tenantId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── GET /api/reports/sales ─────────────────────────── */
router.get('/sales', async (req, res) => {
  try {
    const { group_by = 'client', date_from, date_to } = req.query;
    let sql, params;

    if (group_by === 'product') {
      sql = `SELECT item_data.description, SUM(item_data.total) as revenue, SUM(item_data.quantity) as quantity
             FROM invoices i
             CROSS JOIN JSON_TABLE(i.line_items, '$[*]' COLUMNS (description VARCHAR(255) PATH '$.description', quantity DECIMAL(10,2) PATH '$.quantity', total DECIMAL(10,2) PATH '$.total')) as item_data
             WHERE i.tenant_id = ? AND i.status NOT IN ('void','draft')
             ${date_from ? 'AND i.issue_date >= ?' : ''} ${date_to ? 'AND i.issue_date <= ?' : ''}
             GROUP BY item_data.description ORDER BY revenue DESC LIMIT 50`;
      params = [req.tenantId, ...(date_from ? [date_from] : []), ...(date_to ? [date_to] : [])];
    } else {
      sql = `SELECT c.name as client_name, SUM(i.total_amount) as revenue, COUNT(i.id) as invoice_count
             FROM invoices i JOIN clients c ON i.client_id = c.id
             WHERE i.tenant_id = ? AND i.status NOT IN ('void','draft')
             ${date_from ? 'AND i.issue_date >= ?' : ''} ${date_to ? 'AND i.issue_date <= ?' : ''}
             GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 50`;
      params = [req.tenantId, ...(date_from ? [date_from] : []), ...(date_to ? [date_to] : [])];
    }

    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
