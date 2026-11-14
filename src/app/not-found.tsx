// A path outside /zh and /en that nothing serves. The root layout renders
// no <html>, so this page provides its own shell.
export default function RootNotFound() {
  return (
    <html lang="zh-HK">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#FAF6FF', color: '#2b2535', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 56, fontWeight: 800, color: '#ec4899', margin: '0 0 12px' }}>404</p>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>搵唔到呢一頁 · Page not found</h1>
          <p style={{ opacity: 0.7, margin: '0 0 24px' }}>呢個網址唔存在。This address does not exist.</p>
          <a href="/zh" style={{ background: '#ec4899', color: '#fff', padding: '10px 20px', borderRadius: 12, textDecoration: 'none', fontWeight: 600 }}>返回首頁 · Home</a>
        </div>
      </body>
    </html>
  );
}
