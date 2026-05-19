import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, Tooltip, ResponsiveContainer } from 'recharts'
import './App.css'

const API = import.meta.env.VITE_API_URL || '/api'


const STORE_COLORS = {
  Amazon: '#ff9900', Flipkart: '#2874f0', Nykaa: '#fc2779',
  Myntra: '#ff3f6c', Meesho: '#9b59b6', Sephora: '#000', SSBeauty: '#00b894'
}

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '₹' + Number(n).toLocaleString('en-IN')
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StoreTag({ store }) {
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 3,
      background: STORE_COLORS[store] + '22',
      color: STORE_COLORS[store] || '#888',
      border: `1px solid ${STORE_COLORS[store]}44`,
      fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
      textTransform: 'uppercase', fontWeight: 500
    }}>{store}</span>
  )
}

function MiniChart({ history }) {
  if (!history || history.length < 2) return null
  const data = history.slice(-12).map((h, i) => ({ i, price: h.price }))
  const isDropping = data[data.length - 1]?.price <= data[0]?.price
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Line type="monotone" dataKey="price" stroke={isDropping ? 'var(--green)' : 'var(--amber)'}
          strokeWidth={1.5} dot={false} />
        <Tooltip
          contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, fontSize: 11 }}
          formatter={(v) => [fmt(v), 'price']}
          labelFormatter={() => ''}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function ProductCard({ product, onDelete, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [editThreshold, setEditThreshold] = useState(false)
  const [thresh, setThresh] = useState(product.threshold || '')

  const drop = product.originalPrice && product.currentPrice < product.originalPrice
    ? Math.round((product.originalPrice - product.currentPrice) / product.originalPrice * 100)
    : 0

  const belowThreshold = product.threshold && product.currentPrice <= product.threshold

  async function saveThreshold() {
    await fetch(`${API}/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: thresh })
    })
    setEditThreshold(false)
    onRefresh()
  }

  return (
    <div
      className={`product-card ${belowThreshold ? 'alerted' : ''}`}
      style={{ '--store-color': STORE_COLORS[product.store] || 'var(--border2)' }}
    >
      <div className="card-header" onClick={() => setExpanded(!expanded)}>
        <div className="card-left">
          <div className="product-name">{product.name}</div>
          <div className="card-meta">
            <StoreTag store={product.store} />
            <span className="text-muted">checked {timeAgo(product.history?.at(-1)?.checkedAt)}</span>
            {product.url && (
              <a href={product.url} target="_blank" rel="noreferrer" className="link"
                onClick={e => e.stopPropagation()}>↗ view</a>
            )}
          </div>
        </div>
        <div className="card-right">
          <div className="price-block">
            <span className="current-price">{fmt(product.currentPrice)}</span>
            {drop > 0 && (
              <>
                <span className="original-price">{fmt(product.originalPrice)}</span>
                <span className="drop-pct">-{drop}%</span>
              </>
            )}
          </div>
          {belowThreshold && <span className="alert-pill">🔔 alert!</span>}
          <span className="expand-icon" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}>▼</span>
        </div>
      </div>

      {expanded && (
        <div className="card-expanded">
          <div className="chart-area">
            <MiniChart history={product.history} />
          </div>
          <div className="card-actions">
            <div className="threshold-edit">
              {editThreshold ? (
                <>
                  <input
                    type="number" value={thresh}
                    onChange={e => setThresh(e.target.value)}
                    placeholder="Alert threshold (₹)"
                    className="small-input"
                    autoFocus
                  />
                  <button className="btn-sm accent" onClick={saveThreshold}>save</button>
                  <button className="btn-sm" onClick={() => setEditThreshold(false)}>cancel</button>
                </>
              ) : (
                <>
                  <span className="text-muted">
                    threshold: {product.threshold ? fmt(product.threshold) : 'not set'}
                  </span>
                  <button className="btn-sm" onClick={() => { setEditThreshold(true); setThresh(product.threshold || '') }}>
                    edit
                  </button>
                </>
              )}
            </div>
            <button className="btn-sm danger" onClick={() => onDelete(product.id)}>remove</button>
          </div>
          {product.history && product.history.length > 1 && (
            <div className="history-table">
              <div className="hist-header">
                <span>price</span><span>checked</span>
              </div>
              {[...product.history].reverse().slice(0, 6).map((h, i) => (
                <div key={i} className="hist-row">
                  <span style={{ color: i === 0 ? 'var(--accent)' : 'var(--text2)' }}>{fmt(h.price)}</span>
                  <span className="text-muted">{timeAgo(h.checkedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STORE_DOMAINS = {
  'amazon.in': 'Amazon', 'amazon.com': 'Amazon',
  'amzn.in': 'Amazon', 'amzn.to': 'Amazon', 'a.co': 'Amazon',
  'flipkart.com': 'Flipkart', 'fktr.in': 'Flipkart',
  'nykaa.com': 'Nykaa',
  'myntra.com': 'Myntra',
  'meesho.com': 'Meesho',
  'sephora.com': 'Sephora', 'sephora.in': 'Sephora',
  'ssbeauty.com': 'SSBeauty',
}

function detectStore(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '')
    for (const [domain, store] of Object.entries(STORE_DOMAINS)) {
      if (host.endsWith(domain)) return store
    }
  } catch {}
  return null
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !email.includes('@')) { setError('Please enter a valid email'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() })
      });
      const data = await res.json();
      if (data.isNew) {
        setPendingEmail(email.toLowerCase().trim());
        setConfirmNew(true);
      } else {
        localStorage.setItem('pt_user', JSON.stringify(data.user));
        onLogin(data.user);
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail })
      });
      const data = await res.json();
      if (data.user) {
        localStorage.setItem('pt_user', JSON.stringify(data.user));
        onLogin(data.user);
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (confirmNew) return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #0d0d0d 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)'
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '48px 40px', width: '100%', maxWidth: 420,
        backdropFilter: 'blur(20px)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🤔</div>
        <h2 style={{ fontFamily: 'var(--font-head)', color: '#f0ede8', marginBottom: 8 }}>New here?</h2>
        <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>You're signing up as:</p>
        <p style={{ color: '#c8f135', fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{pendingEmail}</p>
        <p style={{ color: '#888', fontSize: 13, marginBottom: 32 }}>
          This email will be used to manage your tracked products and receive price alerts.
          Are you sure you want to continue?
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setConfirmNew(false)} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
            color: '#888', cursor: 'pointer', fontFamily: 'var(--font-mono)'
          }}>Go back</button>
          <button onClick={handleConfirm} disabled={loading} style={{
            flex: 1, padding: '12px', background: '#c8f135',
            border: 'none', borderRadius: 8, color: '#000',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-mono)'
          }}>{loading ? 'Creating...' : 'Yes, continue →'}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 50%, #0d0d0d 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)'
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '48px 40px', width: '100%', maxWidth: 420,
        backdropFilter: 'blur(20px)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📉</div>
          <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 700, color: '#c8f135', margin: 0 }}>pricewatch</h1>
          <p style={{ color: '#888', fontSize: 14, marginTop: 8 }}>Track prices. Get notified. Save money.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', marginBottom: 8 }}>
              Your email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              style={{
                width: '100%', padding: '12px 16px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, color: '#f0ede8', fontSize: 14,
                fontFamily: 'var(--font-mono)', outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>
          {error && <div style={{ color: '#ff4757', fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '12px', background: '#c8f135',
            color: '#000', border: 'none', borderRadius: 8, fontSize: 14,
            fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1, fontFamily: 'var(--font-mono)'
          }}>
            {loading ? 'Checking...' : 'Get Started →'}
          </button>
        </form>
        <p style={{ textAlign: 'center', fontSize: 11, color: '#555', marginTop: 24 }}>
          No password needed. Just your email.
        </p>
      </div>
    </div>
  );
}

function AddForm({ onAdd, user }) {
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function fetchProduct() {
    const store = detectStore(url)
    if (!store) { setFetchError('Could not detect store from URL. Supported: Amazon, Flipkart, Nykaa, Meesho, Sephora, SSBeauty.'); return }
    setFetching(true); setFetchError('')
    try {
      const res = await fetch(`${API}/fetch-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, store })
      })
      const data = await res.json()
      if (!res.ok) { setFetchError(data.error || 'Failed to fetch product info'); return }
      setForm({ name: data.name || '', store, url, currentPrice: data.price || '', threshold: '' })
    } catch {
      setFetchError('Server not reachable. Is the backend running?')
    } finally {
      setFetching(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.name || !form.store) { setError('Name and store are required.'); return }
    if (!form.threshold) { setError('Expected price is required — we need it to know when to alert you.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, userEmail: user?.email, alertEmail: user?.email })
      })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      setUrl(''); setForm(null)
      onAdd()
    } catch {
      setError('Server not reachable. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const detectedStore = detectStore(url)

  return (
    <div className="add-form">
      <div className="form-header">
        <div className="form-title">Track a new product</div>
        <div className="form-subtitle">paste a product link — we'll auto-fetch the name &amp; price, then alert you when it drops.</div>
      </div>

      {/* Supported stores hint */}
      <div className="supported-stores">
        <span className="hint-label">works with</span>
        <div className="store-chips">
          {Object.keys(STORE_COLORS).map(store => <StoreTag key={store} store={store} />)}
        </div>
        <span className="hint-label">· short links like amzn.in, amzn.to, a.co also work</span>
      </div>

      {/* Step 1: URL input */}
      <div className="form-step">
        <div className="step-label"><span className="step-num">1</span> paste product link</div>
        <div className="url-row">
          <input
            value={url}
            onChange={e => { setUrl(e.target.value); setForm(null); setFetchError('') }}
            onKeyDown={e => e.key === 'Enter' && url && (e.preventDefault(), fetchProduct())}
            placeholder="https://www.amazon.in/dp/... or https://amzn.in/d/..."
          />
          <button
            type="button"
            className="btn-primary"
            onClick={fetchProduct}
            disabled={!url || fetching}
            style={{ whiteSpace: 'nowrap' }}
          >
            {fetching ? 'fetching...' : detectedStore ? `fetch from ${detectedStore}` : 'fetch info →'}
          </button>
        </div>
        {fetchError && <div className="form-error" style={{ marginTop: 6 }}>{fetchError}</div>}
      </div>

      {/* Step 2: Fetched details + submit */}
      {form && (
        <div className="form-step">
          <div className="step-label"><span className="step-num">2</span> confirm details &amp; start tracking</div>
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field full">
                <label>product name *</label>
                <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="product name" />
              </div>
              <div className="field">
                <label>store</label>
                <input value={form.store} readOnly style={{ opacity: 0.6 }} />
              </div>
              <div className="field">
                <label>current price (₹)</label>
                <input type="number" value={form.currentPrice} onChange={e => setField('currentPrice', e.target.value)} placeholder="auto-fetched" />
              </div>
              <div className="field full">
                <label>expected price (₹) *</label>
                <input type="number" value={form.threshold} onChange={e => setField('threshold', e.target.value)} placeholder="alert me when price drops to..." required />
              </div>
              <div className="field full" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'adding...' : 'track product →'}
                </button>
              </div>
            </div>
            {error && <div className="form-error">{error}</div>}
          </form>
        </div>
      )}
    </div>
  )
}

function AlertsPanel({ alerts }) {
  if (!alerts.length) return <div className="empty-state">no alerts yet</div>
  return (
    <div className="alerts-list">
      {alerts.slice(0, 10).map((a, i) => (
        <div key={i} className="alert-row">
          <span className="alert-dot" />
          <div>
            <span className="text-bright">{a.productName}</span>
            <span className="text-muted"> on {a.store} — </span>
            <span style={{ textDecoration: 'line-through', color: 'var(--text3)' }}>{fmt(a.oldPrice)}</span>
            <span style={{ color: 'var(--green)', marginLeft: 4 }}>→ {fmt(a.newPrice)}</span>
          </div>
          <span className="text-muted" style={{ marginLeft: 'auto' }}>{timeAgo(a.triggeredAt)}</span>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [products, setProducts] = useState([])
  const [alerts, setAlerts] = useState([])
  const [tab, setTab] = useState('products')
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState(null)
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('pt_user')
    return saved ? JSON.parse(saved) : null
  })

  function handleLogout() {
    localStorage.removeItem('pt_user')
    setUser(null)
  }

  const load = useCallback(async () => {
    try {
      const [pr, al] = await Promise.all([
        fetch(`${API}/products?email=${user?.email}`).then(r => r.json()),
        fetch(`${API}/alerts`).then(r => r.json())
      ])
      setProducts(Array.isArray(pr) ? pr : [])
      setAlerts(Array.isArray(al) ? al : [])
    } catch { /* server not running yet */ }
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!user) return
    fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email })
    })
      .then(r => r.json())
      .then(data => {
        if (data.isNew) {
          localStorage.removeItem('pt_user')
          setUser(null)
        }
      })
      .catch(() => {})
  }, [])

  async function checkNow() {
    setChecking(true)
    try {
      await fetch(`${API}/check`, { method: 'POST' })
      await load()
      setLastChecked(new Date())
    } finally {
      setChecking(false)
    }
  }

  async function deleteProduct(id) {
    await fetch(`${API}/products/${id}`, { method: 'DELETE' })
    load()
  }

  const totalDrop = products.filter(p => p.currentPrice < p.originalPrice).length
  const triggered = products.filter(p => p.threshold && p.currentPrice <= p.threshold).length

  if (!user) return <LoginScreen onLogin={setUser} />

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">📉</span>
          <span className="logo-text">pricewatch</span>
        </div>
        <nav className="nav">
          <button className={`nav-item ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>
            products <span className="nav-count">{products.length}</span>
          </button>
          <button className={`nav-item ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>
            alerts <span className="nav-count">{alerts.length}</span>
          </button>
          <button className={`nav-item ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>
            + add product
          </button>
        </nav>
        <div className="sidebar-stats">
          <div className="stat"><span className="text-muted">tracking</span><span className="stat-val">{products.length}</span></div>
          <div className="stat"><span className="text-muted">drops found</span><span className="stat-val" style={{ color: 'var(--green)' }}>{totalDrop}</span></div>
          <div className="stat"><span className="text-muted">alerts fired</span><span className="stat-val" style={{ color: 'var(--amber)' }}>{triggered}</span></div>
        </div>
        <div className="sidebar-bottom">
          <button className="check-btn" onClick={checkNow} disabled={checking}>
            {checking ? '⟳ checking...' : '⟳ check prices now'}
          </button>
          {lastChecked && (
            <div className="last-checked text-muted">last: {timeAgo(lastChecked.toISOString())}</div>
          )}
          <div className="cron-note text-muted">auto-checks every 6h</div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
            <button onClick={handleLogout} className="btn-sm danger" style={{ width: '100%' }}>logout</button>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === 'add' && (
          <AddForm onAdd={() => { load(); setTab('products') }} user={user} />
        )}

        {tab === 'products' && (
          <div className="product-list">
            {products.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <div style={{ fontSize: 15, fontFamily: 'var(--font-head)', fontWeight: 600, color: 'var(--text2)' }}>nothing tracked yet</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>paste a product URL to get started</div>
                <button className="btn-sm accent" style={{ marginTop: 8 }} onClick={() => setTab('add')}>
                  + add your first product
                </button>
              </div>
            ) : (
              products.map(p => (
                <ProductCard key={p.id} product={p} onDelete={deleteProduct} onRefresh={load} />
              ))
            )}
          </div>
        )}

        {tab === 'alerts' && (
          <div>
            <div className="section-header">price drop alerts</div>
            <AlertsPanel alerts={alerts} />
          </div>
        )}
      </main>
    </div>
  )
}
