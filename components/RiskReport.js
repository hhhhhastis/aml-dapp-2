export default function RiskReport({ report, type }) {
  if (!report) return null;

  const getRiskColor = (score) => {
    if (score < 30) return '#10b981';
    if (score < 70) return '#f59e0b';
    return '#ef4444';
  };

  const getRiskLabel = (level) => {
    if (level === 'low') return 'Низкий риск';
    if (level === 'medium') return 'Средний риск';
    return 'Высокий риск';
  };

  return (
    <div
      style={{
        background: 'rgba(15, 25, 45, 0.6)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        borderRadius: '32px',
        padding: '2rem',
        marginTop: '2rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
        <div
          style={{
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: `conic-gradient(${getRiskColor(report.riskScore)} 0deg ${report.riskScore * 3.6}deg, #2d3748 ${report.riskScore * 3.6}deg 360deg)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 20px ${getRiskColor(report.riskScore)}`,
          }}
        >
          <span
            style={{
              background: '#0f192d',
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              fontWeight: 'bold',
              color: getRiskColor(report.riskScore),
            }}
          >
            {report.riskScore}
          </span>
        </div>
        <div>
          <h3 style={{ color: '#fff', marginBottom: '0.5rem' }}>
            {type === 'address' ? 'Результат проверки адреса' : 'Результат проверки транзакции'}
          </h3>
          <p style={{ color: '#a0b3d9', wordBreak: 'break-all', marginBottom: '0.5rem' }}>
            {report.address || report.txid}
          </p>
          <span
            style={{
              display: 'inline-block',
              padding: '0.3rem 1rem',
              borderRadius: '20px',
              background: getRiskColor(report.riskScore) + '20',
              color: getRiskColor(report.riskScore),
              fontWeight: '600',
              fontSize: '0.9rem',
            }}
          >
            {getRiskLabel(report.riskLevel)}
          </span>
        </div>
      </div>
      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#6f8ab3' }}>
        <i className="fas fa-clock" /> Проверено: {new Date(report.timestamp).toLocaleString()}
      </p>
    </div>
  );
}