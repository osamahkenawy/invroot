export default function Loader({ size = 'medium', fullPage = false }) {
  if (fullPage) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
        <span className={`spinner spinner-${size}`} />
      </div>
    );
  }
  return <span className={`spinner spinner-${size}`} />;
}

export function PageSkeleton() {
  return (
    <div className="skeleton-page">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row short" />
      <div className="skeleton skeleton-row" />
    </div>
  );
}
