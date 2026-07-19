import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Bank, Plus, EditPencil, Trash, ArrowUp, ArrowDown, Coins, NavArrowRight } from 'iconoir-react';
import api from '../lib/api';
import './Banking.css';

const fmtAmt = (v, cur = 'SAR') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v || 0);

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash'];
const CURRENCIES = ['SAR', 'USD', 'EUR', 'GBP', 'AED'];
const emptyAccForm = { name: '', account_number: '', bank_name: '', currency: 'SAR', balance: '', account_type: 'checking', notes: '' };
const emptyTxForm  = { type: 'credit', amount: '', description: '', reference: '', transaction_date: '' };

export default function Banking() {
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
      const res = await api.get('/banking/accounts');
      setAccounts(res.data.data || []);
      setTotalBal(res.data.totalBalance || 0);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const openCreate = () => { setEditAcc(null); setAccForm(emptyAccForm); setShowAccModal(true); };
  const openEdit   = (a) => { setEditAcc(a); setAccForm({ ...a }); setShowAccModal(true); };

  const saveAccount = async () => {
    if (!accForm.name) return;
    setSaving(true);
    try {
      if (editAcc) await api.put(`/banking/accounts/${editAcc.id}`, accForm);
      else         await api.post('/banking/accounts', accForm);
      setShowAccModal(false);
      loadAccounts();
    } finally { setSaving(false); }
  };

  const deleteAccount = async (id) => {
    if (!window.confirm('Delete this account?')) return;
    await api.delete(`/banking/accounts/${id}`);
    loadAccounts();
  };

  const openTxList = async (acc) => {
    setActiveAcc(acc);
    const res = await api.get(`/banking/accounts/${acc.id}/transactions`);
    setTxs(res.data.data || []);
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
      await api.post(`/banking/accounts/${activeAcc.id}/transactions`, txForm);
      setShowTxModal(false);
      loadAccounts();
      if (showTxList) openTxList(activeAcc);
    } finally { setSaving(false); }
  };

  const typeColor = (t) => (t === 'checking' ? '#3b82f6' : t === 'savings' ? '#16a34a' : t === 'credit' ? '#d97706' : '#7c3aed');

  return (
    <div className="banking-page">
      {/* Summary */}
      <div className="bnk-summary">
        <div className="bnk-summary-icon"><Bank /></div>
        <div>
          <div className="bnk-summary-label">Total Balance Across All Accounts</div>
          <div className="bnk-summary-value">{fmtAmt(totalBal)}</div>
        </div>
        <button className="bnk-add-btn" onClick={openCreate}><Plus /> Add Account</button>
      </div>

      {/* Accounts Grid */}
      {loading ? (
        <div className="bnk-loading"><div className="bnk-spinner" /></div>
      ) : accounts.length === 0 ? (
        <div className="bnk-empty">
          <Bank width={48} height={48} />
          <p>No bank accounts added yet</p>
          <button onClick={openCreate}>Add your first account</button>
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
                  <NavArrowRight width={14} height={14} /> Transactions
                </button>
                <button className="bnk-act primary" onClick={() => openTxModal(acc)}>
                  <Plus width={14} height={14} /> Add Tx
                </button>
                <button className="bnk-act-icon" onClick={() => openEdit(acc)}><EditPencil /></button>
                <button className="bnk-act-icon red" onClick={() => deleteAccount(acc.id)}><Trash /></button>
              </div>
            </div>
          ))}
        </div>
      )}

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
                  <label>Account Name *</label>
                  <input value={accForm.name} onChange={e => setAccForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Main Checking" />
                </div>
                <div className="bnk-form-group">
                  <label>Bank Name</label>
                  <input value={accForm.bank_name || ''} onChange={e => setAccForm(f => ({...f, bank_name: e.target.value}))} placeholder="Bank name" />
                </div>
                <div className="bnk-form-group">
                  <label>Account Number</label>
                  <input value={accForm.account_number || ''} onChange={e => setAccForm(f => ({...f, account_number: e.target.value}))} placeholder="IBAN / account number" />
                </div>
                <div className="bnk-form-group">
                  <label>Account Type</label>
                  <select value={accForm.account_type} onChange={e => setAccForm(f => ({...f, account_type: e.target.value}))}>
                    {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="bnk-form-group">
                  <label>Currency</label>
                  <select value={accForm.currency} onChange={e => setAccForm(f => ({...f, currency: e.target.value}))}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="bnk-form-group span2">
                  <label>Opening Balance</label>
                  <input type="number" min="0" step="0.01" value={accForm.balance || ''} onChange={e => setAccForm(f => ({...f, balance: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="bnk-form-group span2">
                  <label>Notes</label>
                  <textarea rows={2} value={accForm.notes || ''} onChange={e => setAccForm(f => ({...f, notes: e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="bnk-modal-footer">
              <button className="bnk-btn-cancel" onClick={() => setShowAccModal(false)}>Cancel</button>
              <button className="bnk-btn-save" onClick={saveAccount} disabled={saving || !accForm.name}>
                {saving ? 'Saving…' : editAcc ? 'Save Changes' : 'Add Account'}
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
                  <label>Type</label>
                  <select value={txForm.type} onChange={e => setTxForm(f => ({...f, type: e.target.value}))}>
                    <option value="credit">Credit (Money In)</option>
                    <option value="debit">Debit (Money Out)</option>
                  </select>
                </div>
                <div className="bnk-form-group">
                  <label>Amount *</label>
                  <input type="number" min="0" step="0.01" value={txForm.amount || ''} onChange={e => setTxForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                </div>
                <div className="bnk-form-group span2">
                  <label>Description</label>
                  <input value={txForm.description || ''} onChange={e => setTxForm(f => ({...f, description: e.target.value}))} placeholder="Transaction description" />
                </div>
                <div className="bnk-form-group">
                  <label>Reference</label>
                  <input value={txForm.reference || ''} onChange={e => setTxForm(f => ({...f, reference: e.target.value}))} />
                </div>
                <div className="bnk-form-group">
                  <label>Date</label>
                  <input type="date" value={txForm.transaction_date || ''} onChange={e => setTxForm(f => ({...f, transaction_date: e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="bnk-modal-footer">
              <button className="bnk-btn-cancel" onClick={() => setShowTxModal(false)}>Cancel</button>
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
              <h2>Transactions — {activeAcc?.name}</h2>
              <button onClick={() => setShowTxList(false)}>×</button>
            </div>
            <div className="bnk-modal-body">
              {transactions.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>No transactions yet</p>
              ) : (
                <table className="bnk-tx-table">
                  <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th>Type</th><th>Amount</th></tr></thead>
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
              <button className="bnk-btn-cancel" onClick={() => setShowTxList(false)}>Close</button>
              <button className="bnk-btn-save" onClick={() => { setShowTxList(false); openTxModal(activeAcc); }}>+ Add Transaction</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
