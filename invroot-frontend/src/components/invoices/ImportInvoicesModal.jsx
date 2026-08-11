/**
 * Bringing historical invoices in from another system.
 *
 * Three deliberate steps: choose a file, SEE what would happen, then commit.
 *
 * The middle step is the point. An import is the one operation where the person
 * has least ability to predict the result — the file came from somewhere else,
 * the column names are someone else's, and a mistake lands across hundreds of
 * rows at once. So nothing is written until the whole file has been checked and
 * shown back, row by row, with the reason for every rejection.
 */

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Xmark, Upload, Download, WarningTriangle, CheckCircle } from 'iconoir-react';
import api from '../../lib/api.js';
import { fmtCurrency } from '../../utils/currency.js';
import { csvToInvoices, CSV_TEMPLATE } from '../../utils/csv-import.js';
import './ImportInvoicesModal.css';

export default function ImportInvoicesModal({ currency = 'AED', onClose, onDone }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);

  const [invoices, setInvoices] = useState(null);   // parsed from the file
  const [fileName, setFileName] = useState('');
  const [preview, setPreview]   = useState(null);   // dry-run report
  const [result, setResult]     = useState(null);   // committed report
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [createClients, setCreateClients] = useState(true);

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'invroot-invoice-import-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file) => {
    if (!file) return;
    setError(''); setPreview(null); setResult(null);
    setFileName(file.name);

    const text = await file.text();
    const parsed = file.name.toLowerCase().endsWith('.json')
      ? (() => { try {
            const j = JSON.parse(text);
            return { invoices: Array.isArray(j) ? j : (j.invoices || []), error: null };
          } catch { return { invoices: [], error: 'That JSON file could not be read.' }; } })()
      : csvToInvoices(text);

    if (parsed.error) { setError(parsed.error); setInvoices(null); return; }
    if (!parsed.invoices.length) { setError(t('import.no_rows')); setInvoices(null); return; }
    setInvoices(parsed.invoices);

    // Check straight away — there is no reason to make someone press twice.
    await check(parsed.invoices);
  };

  const check = async (rows) => {
    setBusy(true);
    try {
      const res = await api.post('/invoices/import', {
        invoices: rows, dry_run: true, create_missing_clients: createClients,
      });
      if (res.success) setPreview(res);
      else setError(res.message || t('common.action_failed'));
    } finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const res = await api.post('/invoices/import', {
        invoices, dry_run: false, create_missing_clients: createClients,
      });
      /* A partial result is still a result — some rows may have imported even
         when the response is not a clean success, and hiding that would leave
         the person unable to tell what to retry. */
      setResult(res);
      if (res.summary?.imported) onDone?.(res);
      if (!res.success && !res.summary?.imported) setError(res.message || t('common.action_failed'));
    } finally { setBusy(false); }
  };

  /* Server messages arrive as { code, params, msg }. Translate by code, and
     fall back to the English text the server sent — an untranslated locale
     then reads like English rather than showing a raw key. */
  const say = (item) => {
    if (typeof item === 'string') return item;          // tolerate older shapes
    /* The interpolated values are identifiers too. Leaving them raw produced
       half-translated sentences like "مُعلَّمة paid دون سجلات دفع" and
       "يجب كتابة issue_date بصيغة…" — worse than either language alone. */
    const params = { ...item.params };
    if (params.status) params.status = t(`invoices.status.${params.status}`, { defaultValue: params.status });
    if (params.field)  params.field  = t(`import.field.${params.field}`,     { defaultValue: params.field });
    return t(`import.err.${item.code}`, { ...params, defaultValue: item.msg });
  };

  const report = result || preview;
  const rows = report?.rows || [];
  const problems = rows.filter(r => r.outcome === 'invalid' || r.outcome === 'failed');
  const warned   = rows.filter(r => r.outcome !== 'invalid' && r.warnings?.length);

  return (
    <div className="imp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="imp-sheet">
        <div className="imp-bar">
          <div className="imp-bar-title">{t('import.title')}</div>
          <button className="imp-close" onClick={onClose}><Xmark /></button>
        </div>

        <div className="imp-body">
          {!report && (
            <>
              <p className="imp-lead">{t('import.lead')}</p>
              <ul className="imp-points">
                <li>{t('import.point_numbers')}</li>
                <li>{t('import.point_totals')}</li>
                <li>{t('import.point_silent')}</li>
              </ul>

              <div className="imp-drop" onClick={() => fileRef.current?.click()}>
                <Upload />
                <div className="imp-drop-main">{t('import.choose_file')}</div>
                <div className="imp-drop-sub">{t('import.formats')}</div>
              </div>
              <input
                ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json"
                style={{ display: 'none' }}
                onChange={e => onFile(e.target.files?.[0])}
              />

              <button className="imp-template" onClick={downloadTemplate}>
                <Download /> {t('import.download_template')}
              </button>
            </>
          )}

          {error && <div className="imp-error">{error}</div>}
          {busy && !report && <div className="imp-busy"><span className="spinner" /> {t('import.checking')}</div>}

          {report && (
            <>
              <div className="imp-summary">
                <div className="imp-file">{fileName}</div>
                <div className="imp-stats">
                  <span className="imp-stat imp-stat-ok">
                    {result
                      ? t('import.imported_n', { count: report.summary.imported ?? 0 })
                      : t('import.ready_n', { count: report.summary.importable })}
                  </span>
                  {report.summary.skipped > 0 &&
                    <span className="imp-stat">{t('import.skipped_n', { count: report.summary.skipped })}</span>}
                  {problems.length > 0 &&
                    <span className="imp-stat imp-stat-bad">{t('import.problem_n', { count: problems.length })}</span>}
                  <span className="imp-stat">{fmtCurrency(report.summary.value, currency)}</span>
                </div>
              </div>

              {!result && report.summary.clients_to_create > 0 && (
                <label className="imp-check">
                  <input type="checkbox" checked={createClients}
                         onChange={e => { setCreateClients(e.target.checked); check(invoices); }} />
                  <span>{t('import.create_clients', { count: report.summary.clients_to_create })}</span>
                </label>
              )}

              <div className="imp-table-wrap">
                <table className="imp-table">
                  <thead>
                    <tr>
                      <th>{t('invoices.number')}</th>
                      <th>{t('common.client')}</th>
                      <th className="imp-num">{t('common.amount')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('import.outcome')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.index} className={`imp-row imp-row-${r.outcome}`}>
                        <td className="imp-mono">{r.invoice_number || '—'}</td>
                        <td>{r.client || '—'}</td>
                        <td className="imp-num">{r.total ? fmtCurrency(r.total, currency) : '—'}</td>
                        <td>{r.status ? t(`invoices.status.${r.status}`, { defaultValue: r.status }) : '—'}</td>
                        <td>
                          <span className={`imp-badge imp-badge-${r.outcome}`}>
                            {t(`import.outcome_${r.outcome}`)}
                          </span>
                          {r.skip_reason && <div className="imp-note">{t('import.already_imported')}</div>}
                          {r.errors?.map((e, i) => <div key={i} className="imp-note imp-note-bad">{say(e)}</div>)}
                          {r.warnings?.map((w, i) => <div key={i} className="imp-note imp-note-warn">{say(w)}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!result && warned.length > 0 && (
                <div className="imp-warnbar">
                  <WarningTriangle />
                  {t('import.warnings_note', { count: warned.length })}
                </div>
              )}

              {result && (
                <div className="imp-done">
                  <CheckCircle />
                  {t('import.done', { count: result.summary.imported ?? 0 })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="imp-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            {result ? t('common.close') : t('common.cancel')}
          </button>
          {report && !result && (
            <button
              className="btn btn-primary"
              disabled={busy || !report.summary.importable}
              onClick={commit}
            >
              {busy
                ? <span className="spinner spinner-sm" />
                : t('import.import_n', { count: report.summary.importable })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
