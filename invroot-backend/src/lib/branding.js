/**
 * The tenant's brand assets, resolved to URLs something else can actually load.
 *
 * `tenants.logo_url` does NOT hold a URL. It holds whatever the upload left
 * behind: a storage key (`tenants/42/logos/ab12.png`) on the s3 driver, or a
 * bare filename on the legacy local one. Neither is fetchable on its own —
 * `resolveAssetUrl` in storage.js is what turns either form into a signed or
 * absolute URL.
 *
 * This module exists because that step was easy to forget. The invoice route
 * had its own private helper that did it, with a comment calling itself "the
 * one funnel every PDF goes through" — while the receipt and quote routes each
 * built their own tenant object straight from `SELECT * FROM tenants` and
 * skipped it. Those PDFs went out with `<img src="tenants/42/logos/ab12.png">`,
 * and because the renderer loads its HTML through `page.setContent()` there is
 * no base URL to resolve a relative path against, so it could not resolve to
 * anything at all: every receipt and quote showed a broken-image icon where the
 * customer's own brand should be.
 *
 * Now there is genuinely one funnel. Anything rendering a document for a tenant
 * calls this and gets assets that load.
 */

import { query } from './database.js';
import { withAssetUrls } from './storage.js';

/**
 * Tenant fields the document templates read, plus the default signatory, with
 * logo/stamp/signature resolved to fetchable URLs.
 *
 * @param {number} tenantId
 * @returns {Promise<object>} `{}` when the tenant is gone, so a template that
 *   only reads optional fields still renders rather than throwing.
 */
export async function getTenantWithBranding(tenantId) {
  const [tenant] = await query(
    `SELECT company_name, logo_url, address, tax_id, footer_text, invoice_terms,
            stamp_url, currency, lang,
            primary_color, accent_color, invoice_template
     FROM tenants WHERE id = ?`,
    [tenantId]
  );
  if (!tenant) return {};

  /* Optional: a tenant that never set one still gets a document, just without
     a signature block. A failure here must not cost them the PDF. */
  const [sig] = await query(
    `SELECT signature_url, name AS signatory_name, title AS signatory_title
       FROM company_signatories
      WHERE tenant_id = ? AND is_default = 1
      LIMIT 1`,
    [tenantId]
  ).catch(() => [null]);

  /* Also optional, and for the same reason: a tenant who has not nominated an
     account to publish still gets an invoice, just without a payment block. */
  const [bank] = await query(
    `SELECT name AS bank_account_label, account_holder, bank_name, branch,
            account_number, iban, swift, routing_code, currency AS bank_currency
       FROM bank_accounts
      WHERE tenant_id = ? AND show_on_invoices = 1 AND is_active = 1
      LIMIT 1`,
    [tenantId]
  ).catch(() => [null]);

  return withAssetUrls({ ...tenant, ...(sig || {}), bank: bank || null });
}
