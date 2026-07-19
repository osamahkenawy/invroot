import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api.js';
import Loader from '../components/Loader.jsx';
import { Bell, Plus, Xmark, Check, Trash, Mail, Phone, Calendar, Clock } from 'iconoir-react';
import { fmtDate } from '../utils/date.js';
import './Reminders.css';

const CHANNELS = ['email', 'sms', 'both'];

const STATUS_COLOR = {
  sent:    { bg: '#dcfce7', color: '#16a34a' },
  failed:  { bg: '#fee2e2', color: '#dc2626' },
  pending: { bg: '#fef9c3', color: '#854d0e' },
};

export default function Reminders() {
  const { t } = useTranslation();
  const [tab,       setTab]       = useState('rules');   // 'rules' | 'templates' | 'log'
  const [rules,     setRules]     = useState([]);
  const [templates, setTemplates] = useState([]);
  const [log,       setLog]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showRule,  setShowRule]  = useState(false);
  const [showTpl,   setShowTpl]   = useState(false);
  const [editRule,  setEditRule]  = useState(null);
  const [editTpl,   setEditTpl]   = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [rRes, tRes, lRes] = await Promise.all([
        api.get('/reminders/rules'),
        api.get('/reminders/templates'),
        api.get('/reminders/log'),
      ]);
      if (rRes.success) setRules(rRes.data);
      if (tRes.success) setTemplates(tRes.data);
      if (lRes.success) setLog(lRes.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const toggleRule = async (rule) => {
    await api.put(`/reminders/rules/${rule.id}`, { ...rule, is_active: rule.is_active ? 0 : 1 });
    fetchAll();
  };

  const deleteRule = async (id) => {
    if (!confirm(t('reminders.confirm_delete_rule'))) return;
    await api.delete(`/reminders/rules/${id}`);
    fetchAll();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('reminders.title')}</h1>
          <p className="page-subtitle">{t('reminders.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'rules'     && <button className="btn btn-primary" onClick={() => { setEditRule(null); setShowRule(true); }}><Plus /> {t('reminders.new_rule')}</button>}
          {tab === 'templates' && <button className="btn btn-primary" onClick={() => { setEditTpl(null); setShowTpl(true); }}><Plus /> {t('reminders.new_template')}</button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ padding: '0 0 0 0', overflow: 'hidden' }}>
        <div className="rem-tabs">
          {[['rules', Bell, 'reminders.rules'], ['templates', Mail, 'reminders.templates'], ['log', Clock, 'reminders.log']].map(([key, Icon, labelKey]) => (
            <button key={key} className={`rem-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              <Icon style={{ width: 15, height: 15 }} /> {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {loading ? <Loader fullPage /> : (
        <>
          {/* ── RULES ── */}
          {tab === 'rules' && (
            <div className="card" style={{ marginTop: 16 }}>
              {rules.length === 0 ? (
                <div className="empty-state">
                  <Bell className="empty-state-icon" />
                  <div className="empty-state-title">{t('reminders.no_rules')}</div>
                  <div className="empty-state-sub">{t('reminders.no_rules_sub')}</div>
                  <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowRule(true)}><Plus /> {t('reminders.new_rule')}</button>
                </div>
              ) : (
                <div className="rem-rules-grid">
                  {rules.map(rule => (
                    <div key={rule.id} className={`rem-rule-card ${rule.is_active ? '' : 'inactive'}`}>
                      <div className="rem-rule-left">
                        <div className="rem-rule-icon">
                          {rule.channel === 'sms' ? <Phone /> : <Mail />}
                        </div>
                        <div>
                          <div className="rem-rule-name">{rule.name}</div>
                          <div className="rem-rule-meta">
                            {rule.days_offset === 0
                              ? t('reminders.on_due_date')
                              : rule.days_offset > 0
                                ? t('reminders.days_after', { n: rule.days_offset })
                                : t('reminders.days_before', { n: Math.abs(rule.days_offset) })}
                            {' · '}
                            <span className="rem-channel-badge">{rule.channel}</span>
                          </div>
                        </div>
                      </div>
                      <div className="rem-rule-actions">
                        <button
                          className={`rem-toggle ${rule.is_active ? 'on' : 'off'}`}
                          onClick={() => toggleRule(rule)}
                          title={rule.is_active ? t('common.deactivate') : t('common.activate')}
                        >
                          <span className="rem-toggle-knob" />
                        </button>
                        <button className="icon-btn" onClick={() => { setEditRule(rule); setShowRule(true); }}>✏️</button>
                        <button className="icon-btn danger" onClick={() => deleteRule(rule.id)}><Trash /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TEMPLATES ── */}
          {tab === 'templates' && (
            <div className="card" style={{ marginTop: 16 }}>
              {templates.length === 0 ? (
                <div className="empty-state">
                  <Mail className="empty-state-icon" />
                  <div className="empty-state-title">{t('reminders.no_templates')}</div>
                  <div className="empty-state-sub">{t('reminders.no_templates_sub')}</div>
                  <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setShowTpl(true)}><Plus /> {t('reminders.new_template')}</button>
                </div>
              ) : (
                <div className="rem-tpl-grid">
                  {templates.map(tpl => (
                    <div key={tpl.id} className="rem-tpl-card">
                      <div className="rem-tpl-header">
                        <span className="rem-tpl-name">{tpl.name}</span>
                        <span className="rem-tpl-type">{tpl.type}</span>
                      </div>
                      <div className="rem-tpl-subject">EN: {tpl.subject_en}</div>
                      {tpl.subject_ar && <div className="rem-tpl-subject ar">{tpl.subject_ar} :AR</div>}
                      <div className="rem-tpl-actions">
                        <button className="btn btn-sm btn-outline" onClick={() => { setEditTpl(tpl); setShowTpl(true); }}>{t('common.edit')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── LOG ── */}
          {tab === 'log' && (
            <div className="card" style={{ marginTop: 16 }}>
              {log.length === 0 ? (
                <div className="empty-state">
                  <Clock className="empty-state-icon" />
                  <div className="empty-state-title">{t('reminders.no_log')}</div>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('invoices.number')}</th>
                        <th>{t('reminders.rule')}</th>
                        <th>{t('reminders.channel')}</th>
                        <th>{t('common.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.map(entry => {
                        const sc = STATUS_COLOR[entry.status] || STATUS_COLOR.pending;
                        return (
                          <tr key={entry.id}>
                            <td>{fmtDate(entry.sent_at)}</td>
                            <td className="td-mono">{entry.invoice_number || '—'}</td>
                            <td>{entry.rule_name || '—'}</td>
                            <td><span className="rem-channel-badge">{entry.channel}</span></td>
                            <td><span className="status-badge" style={{ background: sc.bg, color: sc.color }}>{entry.status}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── RULE MODAL ── */}
      {showRule && (
        <RuleModal
          rule={editRule}
          templates={templates}
          onClose={() => setShowRule(false)}
          onSave={() => { setShowRule(false); fetchAll(); }}
        />
      )}

      {/* ── TEMPLATE MODAL ── */}
      {showTpl && (
        <TemplateModal
          tpl={editTpl}
          onClose={() => setShowTpl(false)}
          onSave={() => { setShowTpl(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

/* ── Rule Modal ─────────────────────────────────────── */
function RuleModal({ rule, templates, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: rule?.name || '',
    days_offset: rule?.days_offset ?? -3,
    channel: rule?.channel || 'email',
    template_id: rule?.template_id || '',
    is_active: rule?.is_active ?? 1,
  });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (rule?.id) {
        await api.put(`/reminders/rules/${rule.id}`, form);
      } else {
        await api.post('/reminders/rules', form);
      }
      onSave();
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{rule ? t('reminders.edit_rule') : t('reminders.new_rule')}</h3>
          <button className="icon-btn" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          <div className="field-group">
            <label className="field-label">{t('reminders.rule_name')} *</label>
            <input className="field-input" value={form.name} onChange={set('name')} placeholder="e.g. 3 days before due" />
          </div>
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">{t('reminders.days_offset')}</label>
              <input className="field-input" type="number" value={form.days_offset} onChange={set('days_offset')}
                placeholder="Negative = before due, 0 = on due, positive = after" />
              <p className="field-hint">
                {form.days_offset < 0 ? `${Math.abs(form.days_offset)} day(s) before due date`
                  : form.days_offset > 0 ? `${form.days_offset} day(s) after due date`
                  : 'On the due date'}
              </p>
            </div>
            <div className="field-group">
              <label className="field-label">{t('reminders.channel')}</label>
              <select className="field-input" value={form.channel} onChange={set('channel')}>
                {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">{t('reminders.template')}</label>
            <select className="field-input" value={form.template_id} onChange={set('template_id')}>
              <option value="">{t('reminders.default_template')}</option>
              {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked ? 1 : 0 }))} />
              {t('reminders.active')}
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '...' : <><Check /> {t('common.save')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Template Modal ──────────────────────────────────── */
function TemplateModal({ tpl, onClose, onSave }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: tpl?.name || '',
    type: tpl?.type || 'reminder',
    subject_en: tpl?.subject_en || '',
    body_en: tpl?.body_en || '',
    subject_ar: tpl?.subject_ar || '',
    body_ar: tpl?.body_ar || '',
  });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.subject_en.trim()) return;
    setSaving(true);
    try {
      if (tpl?.id) {
        await api.put(`/reminders/templates/${tpl.id}`, form);
      } else {
        await api.post('/reminders/templates', form);
      }
      onSave();
    } finally { setSaving(false); }
  };

  const MERGE_FIELDS = ['{{client_name}}', '{{amount_due}}', '{{invoice_number}}', '{{due_date}}', '{{invoice_link}}'];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel rem-tpl-modal">
        <div className="modal-header">
          <h3>{tpl ? t('reminders.edit_template') : t('reminders.new_template')}</h3>
          <button className="icon-btn" onClick={onClose}><Xmark /></button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">{t('reminders.template_name')} *</label>
              <input className="field-input" value={form.name} onChange={set('name')} placeholder="Template name" />
            </div>
            <div className="field-group">
              <label className="field-label">{t('reminders.type')}</label>
              <select className="field-input" value={form.type} onChange={set('type')}>
                <option value="reminder">Reminder</option>
                <option value="overdue">Overdue Notice</option>
                <option value="receipt">Receipt Confirmation</option>
                <option value="thank_you">Thank You</option>
              </select>
            </div>
          </div>

          <div className="rem-merge-fields">
            <span className="rem-merge-label">{t('reminders.merge_fields')}:</span>
            {MERGE_FIELDS.map(f => <code key={f} className="rem-merge-chip">{f}</code>)}
          </div>

          <div className="rem-lang-tabs">
            <div className="rem-lang-section">
              <h4>🇬🇧 English</h4>
              <div className="field-group">
                <label className="field-label">{t('reminders.subject')} (EN) *</label>
                <input className="field-input" value={form.subject_en} onChange={set('subject_en')} placeholder="Subject line" />
              </div>
              <div className="field-group">
                <label className="field-label">{t('reminders.body')} (EN)</label>
                <textarea className="field-input" rows={5} value={form.body_en} onChange={set('body_en')}
                  placeholder="Dear {{client_name}}, your invoice {{invoice_number}} of {{amount_due}} is due on {{due_date}}." />
              </div>
            </div>
            <div className="rem-lang-section">
              <h4>🇸🇦 Arabic</h4>
              <div className="field-group">
                <label className="field-label">{t('reminders.subject')} (AR)</label>
                <input className="field-input" dir="rtl" value={form.subject_ar} onChange={set('subject_ar')} placeholder="الموضوع" />
              </div>
              <div className="field-group">
                <label className="field-label">{t('reminders.body')} (AR)</label>
                <textarea className="field-input" dir="rtl" rows={5} value={form.body_ar} onChange={set('body_ar')} placeholder="محتوى الرسالة..." />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '...' : <><Check /> {t('common.save')}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
