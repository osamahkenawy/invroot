import { useState, useEffect, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Bank, Plus, EditPencil, Trash, ArrowUp, ArrowDown, Coins, NavArrowRight } from 'iconoir-react';
import api from '../lib/api';
import { useToastContext } from '../context/ToastContext.jsx';
import { AuthContext } from '../context/AuthContext.jsx';
import Reconcile from '../components/banking/Reconcile.jsx';
import './Banking.css';
import { CURRENCIES } from '../data/currencies.js';

const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v || 0);

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash'];
const emptyAccForm = {
  name: '', account_number: '', bank_name: '', currency: 'SAR', balance: '',
  account_type: 'checking', notes: '',
  // Printed on invoices; see the "payment details" block in the modal.
  account_holder: '', iban: '', swift: '', branch: '', routing_code: '',
  show_on_invoices: false,
};
const emptyTxForm  = { type: 'credit', amount: '', description: '', reference: '', transaction_date: '' };

export default function Banking() {
  const { t } = useTranslation();
  const { showToast } = useToastContext();
  const { tenant } = useContext(AuthContext);
  const [accounts, setAccounts]   = useState([]);
  const [totalBal, setTotalBal]   = useState(0);
  const [loading, setLoading]     = useState(true);
  const [showAccModal, setShowAccModal] = useState(false);
  const [showTxModal, setShowTxModal]   = useState(false);
  const [showTxList, setShowTxList]     = useState(false);
  const [activeAcc, setActiveAcc] = useState(null);
  const [transactions, setTxs]    = useState([]);
  const [editAcc, setEditAcc]     = useState(null);
  const [accForm, setAccForm]     = useState(emptyAccForm);
  const [txForm, setTxForm]       = useState(emptyTxForm);
  const [saving, setSaving]       = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      /* `res.data`, not `res.data.data`. The api client returns the parsed body
         already; the extra hop is an axios-ism, and it silently resolved to
         undefined — so the accounts list rendered empty and the total read
         AED 0.00 no matter what was actually in the bank. */
      const res = await api.get('/banking/accounts');
      setAccounts(res.data || []);
      setTotalBal(res.totalBalance || 0);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const openCreate = () => { setEditAcc(null); setAccForm({ ...emptyAccForm, currency: tenant?.currency || 'SAR' }); setShowAccModal(true); };
  const openEdit   = (a) => { setEditAcc(a); setAccForm({ ...a }); setShowAccModal(true); };

  const saveAccount = async () => {
    if (!accForm.name) return;
    setSaving(true);
    try {
      const res = editAcc
        ? await api.put(`/banking/accounts/${editAcc.id}`, accForm)
        : await api.post('/banking/accounts', accForm);
      if (res?.success === false) { showToast(res.message || t('common.save_failed'), 'error'); return; }
      showToast(t(editAcc ? 'common.updated_success' : 'common.created_success'));
      setShowAccModal(false);
      loadAccounts();
    } finally { setSaving(false); }
  };

  const deleteAccount = async (id) => {
    if (!window.confirm('Delete this account?')) return;
    const res = await api.delete(`/banking/accounts/${id}`);
    if (res?.success === false) return showToast(res.message || t('common.delete_failed'), 'error');
    showToast(t('common.deleted_success'));
    loadAccounts();
  };

  const openTxList = async (acc) => {
    setActiveAcc(acc);
    const res = await api.get(`/banking/accounts/${acc.id}/transactions`);
    setTxs(res.data || []);
    setShowTxList(true);
  };

  const openTxModal = (acc) => {
    setActiveAcc(acc);
    setTxForm({ ...emptyTxForm, transaction_date: new Date().toISOString().slice(0, 10) });
    setShowTxModal(true);
  };

  const saveTx = async () => {
    if (!txForm.amount) return;
    setSaving(true);
    try {
      const res = await api.post(`/banking/accounts/${activeAcc.id}/transactions`, txForm);
      if (res?.success === false) { showToast(res.message || t('common.save_failed'), 'error'); return; }
      showToast(t('common.created_success'));
      setShowTxModal(false);
      loadAccounts();
      if (showTxList) openTxList(activeAcc);
    } finally { setSaving(false); }
  };

  /* `type`, not `t` — `t` is the translation function in this scope, and
     shadowing it is how Toast.jsx crashed the app. */
  const typeColor = (type) => (type === 'checking' ? '#3b82f6' : type === 'savings' ? '#16a34a' : type === 'credit' ? '#d97706' : '#7c3aed');

  return (
    <div className="banking-page">
      {/* Summary */}
      <div className="bnk-summary">
        <div className="bnk-summary-icon"><Bank /></div>
        <div>
          <div className="bnk-summary-label">{t('banking.total_balance')}</div>
          <div className="bnk-summary-value">{fmtAmt(totalBal, tenant?.currency)}</div>
        </div>
        <button className="bnk-add-btn" onClick={openCreate}><Plus /> {t('banking.add_account')}</button>
      </div>

      {/* Accounts Grid */}
      {loading ? (
        <div className="bnk-loading"><div className="bnk-spinner" /></div>
      ) : accounts.length === 0 ? (
        <div className="bnk-empty">
          <Bank width={48} height={48} />
          <p>{t('banking.none_yet')}</p>
          <button onClick={openCreate}>{t('banking.add_first')}</button>
        </div>
      ) : (
        <div className="bnk-grid">
          {accounts.map(acc => (
            <div key={acc.id} className="bnk-card" style={{ '--acc-color': typeColor(acc.account_type) }}>
              <div className="bnk-card-header">
                <div>
                  <div className="bnk-card-name">{acc.name}</div>
                  {acc.bank_name && <div className="bnk-card-bank">{acc.bank_name}</div>}
                </div>
                <span className="bnk-type-badge">{acc.account_type}</span>
              </div>
              {acc.account_number && <div className="bnk-card-num">•••• {acc.account_number.slice(-4)}</div>}
              <div className="bnk-card-balance">{fmtAmt(acc.balance, acc.currency)}</div>
              <div className="bnk-card-actions">
                <button className="bnk-act" onClick={() => openTxList(acc)}>
                  <NavArrowRight width={14} height={14} /> {t('banking.transactions')}
                </button>
                <button className="bnk-act primary" onClick={() => openTxModal(acc)}>
                  <Plus width={14} height={14} /> {t('banking.add_tx')}
                </button>
                <button className="bnk-act-icon" onClick={() => openEdit(acc)}><EditPencil /></button>
                <button className="bnk-act-icon red" onClick={() => deleteAccount(acc.id)}><Trash /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reconciliation is a TASK you perform against the accounts, so it sits
          below them. Above, it buried the accounts — the actual subject of this
          page — under as many as 200 payment rows. Renders nothing when there
          is nothing outstanding. */}
      <Reconcile
        currency={tenant?.currency}
        hasAccounts={accounts.length > 0}
        onAddAccount={openCreate}
        onChanged={loadAccounts}
      />

      {/* Account Modal */}
      {showAccModal && (
        <div className="bnk-overlay" onClick={e => e.target === e.currentTarget && setShowAccModal(false)}>
          <div className="bnk-modal">
            <div className="bnk-modal-header">
              <h2>{editAcc ? 'Edit Account' : 'New Bank Account'}</h2>
              <button onClick={() => setShowAccModal(false)}>×</button>
            </div>
            <div className="bnk-modal-body">
              <div className="bnk-form-grid">
                <div className="bnk-form-group span2">
                  <label>{t('banking.account_name')} *</label>
                  <input value={accForm.name} onChange={e => setAccForm(f => ({...f, name: e.target.value}))} placeholder={t('banking.ph_account')} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.bank_name')}</label>
                  <input value={accForm.bank_name || ''} onChange={e => setAccForm(f => ({...f, bank_name: e.target.value}))} placeholder={t('banking.ph_bank')} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.account_number')}</label>
                  <input value={accForm.account_number || ''} onChange={e => setAccForm(f => ({...f, account_number: e.target.value}))} placeholder={t('banking.ph_iban')} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.account_type')}</label>
                  <select value={accForm.account_type} onChange={e => setAccForm(f => ({...f, account_type: e.target.value}))}>
                    {ACCOUNT_TYPES.map(type => <option key={type}>{type}</option>)}
                  </select>
                </div>
                <div className="bnk-form-group">
                  <label>{t('common.currency')}</label>
                  <select value={accForm.currency} onChange={e => setAccForm(f => ({...f, currency: e.target.value}))}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="bnk-form-group span2">
                  <label>{t('banking.opening_balance')}</label>
                  <input type="number" min="0" step="0.01" value={accForm.balance || ''} onChange={e => setAccForm(f => ({...f, balance: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="bnk-form-group span2">
                  <label>{t('common.notes')}</label>
                  <textarea rows={2} value={accForm.notes || ''} onChange={e => setAccForm(f => ({...f, notes: e.target.value}))} />
                </div>

                {/* Details a customer pays into. Separate from the fields
                    above, which describe the account for reconciliation —
                    these are the ones that get printed and read by someone
                    else, so they are worth entering carefully. */}
                <div className="bnk-form-sep span2">
                  <span>{t('banking.pay_section')}</span>
                  <small>{t('banking.pay_hint')}</small>
                </div>
                <div className="bnk-form-group span2">
                  <label>{t('banking.account_holder')}</label>
                  <input value={accForm.account_holder || ''}
                         onChange={e => setAccForm(f => ({...f, account_holder: e.target.value}))}
                         placeholder={t('banking.ph_holder')} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.iban')}</label>
                  <input value={accForm.iban || ''} dir="ltr"
                         onChange={e => setAccForm(f => ({...f, iban: e.target.value}))}
                         placeholder="AE07 0331 2345 6789 0123 456" />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.swift')}</label>
                  <input value={accForm.swift || ''} dir="ltr"
                         onChange={e => setAccForm(f => ({...f, swift: e.target.value}))}
                         placeholder="EBILAEAD" />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.branch')}</label>
                  <input value={accForm.branch || ''}
                         onChange={e => setAccForm(f => ({...f, branch: e.target.value}))}
                         placeholder={t('banking.ph_branch')} />
                </div>
                {/* One generic field rather than six country-specific ones:
                    a US routing number, a UK sort code, an Indian IFSC and an
                    Australian BSB all belong here, and five of six would sit
                    empty on any given invoice. */}
                <div className="bnk-form-group">
                  <label>{t('banking.routing_code')}</label>
                  <input value={accForm.routing_code || ''} dir="ltr"
                         onChange={e => setAccForm(f => ({...f, routing_code: e.target.value}))}
                         placeholder={t('banking.ph_routing')} />
                </div>
                <div className="bnk-form-group span2">
                  <label className="bnk-check">
                    <input type="checkbox" checked={!!accForm.show_on_invoices}
                           onChange={e => setAccForm(f => ({...f, show_on_invoices: e.target.checked}))} />
                    <span>{t('banking.show_on_invoices')}</span>
                  </label>
                  <small className="bnk-field-hint">{t('banking.show_on_invoices_hint')}</small>
                </div>
              </div>
            </div>
            <div className="bnk-modal-footer">
              <button className="bnk-btn-cancel" onClick={() => setShowAccModal(false)}>{t('common.cancel')}</button>
              <button className="bnk-btn-save" onClick={saveAccount} disabled={saving || !accForm.name}>
                {saving ? t('common.saving') : t(editAcc ? 'banking.save_changes' : 'banking.add_account')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {showTxModal && (
        <div className="bnk-overlay" onClick={e => e.target === e.currentTarget && setShowTxModal(false)}>
          <div className="bnk-modal">
            <div className="bnk-modal-header">
              <h2>Add Transaction — {activeAcc?.name}</h2>
              <button onClick={() => setShowTxModal(false)}>×</button>
            </div>
            <div className="bnk-modal-body">
              <div className="bnk-form-grid">
                <div className="bnk-form-group">
                  <label>{t('banking.type')}</label>
                  <select value={txForm.type} onChange={e => setTxForm(f => ({...f, type: e.target.value}))}>
                    <option value="credit">{t('banking.credit_in')}</option>
                    <option value="debit">{t('banking.debit_out')}</option>
                  </select>
                </div>
                <div className="bnk-form-group">
                  <label>{t('common.amount')} *</label>
                  <input type="number" min="0" step="0.01" value={txForm.amount || ''} onChange={e => setTxForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="bnk-form-group span2">
                  <label>{t('banking.description')}</label>
                  <input value={txForm.description || ''} onChange={e => setTxForm(f => ({...f, description: e.target.value}))} placeholder={t('banking.ph_tx_desc')} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('banking.reference')}</label>
                  <input value={txForm.reference || ''} onChange={e => setTxForm(f => ({...f, reference: e.target.value}))} />
                </div>
                <div className="bnk-form-group">
                  <label>{t('common.date')}</label>
                  <input type="date" value={txForm.transaction_date || ''} onChange={e => setTxForm(f => ({...f, transaction_date: e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="bnk-modal-footer">
              <button className="bnk-btn-cancel" onClick={() => setShowTxModal(false)}>{t('common.cancel')}</button>
              <button className="bnk-btn-save" onClick={saveTx} disabled={saving || !txForm.amount}>
                {saving ? 'Saving…' : 'Add Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions List */}
      {showTxList && (
        <div className="bnk-overlay" onClick={e => e.target === e.currentTarget && setShowTxList(false)}>
          <div className="bnk-modal wide">
            <div className="bnk-modal-header">
              <h2>{t('banking.transactions')} — {activeAcc?.name}</h2>
              <button onClick={() => setShowTxList(false)}>×</button>
            </div>
            <div className="bnk-modal-body">
              {transactions.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>{t('banking.no_tx')}</p>
              ) : (
                <table className="bnk-tx-table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('banking.description')}</th><th>{t('banking.reference')}</th><th>{t('banking.type')}</th><th>{t('common.amount')}</th></tr></thead>
                  <tbody>
                    {transactions.map(tx => (
                      <tr key={tx.id}>
                        <td>{tx.transaction_date ? new Date(tx.transaction_date).toLocaleDateString() : '—'}</td>
                        <td>{tx.description || '—'}</td>
                        <td>{tx.reference || '—'}</td>
                        <td><span className={`bnk-tx-type ${tx.type}`}>{tx.type}</span></td>
                        <td className={`bnk-tx-amt ${tx.type}`}>
                          {tx.type === 'credit' ? '+' : '-'}{fmtAmt(tx.amount, activeAcc?.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="bnk-modal-footer">
              <button className="bnk-btn-cancel" onClick={() => setShowTxList(false)}>{t('common.close')}</button>
              <button className="bnk-btn-save" onClick={() => { setShowTxList(false); openTxModal(activeAcc); }}>+ {t('banking.add_transaction')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
