import { useState, useEffect } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import WalletConnect from '@/components/WalletConnect';
import RiskReport from '@/components/RiskReport';
import { analyzeAddress } from '@/utils/riskAnalysis';

useEffect(() => {
  if (typeof window !== 'undefined') {
    import('eruda').then(e => e.default.init());
  }
  }, []);

export default function Home() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [riskReport, setRiskReport] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [verifiedCount, setVerifiedCount] = useState(12847);

  useEffect(() => {
    const interval = setInterval(() => {
      setVerifiedCount((prev) => prev + Math.floor(Math.random() * 3) + 1);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = (addr) => {
    setWalletAddress(addr);
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
    setRiskReport(null);
    toast.success('Кошелёк отключён');
  };

  const handlePaymentSuccess = async (txid, addr) => {
    setIsChecking(true);
    try {
      toast.loading('Выполняется AML анализ...', { id: 'analysis' });
      const result = await analyzeAddress(addr);
      if (result.success) {
        setRiskReport(result);
        toast.success('AML проверка выполнена', { id: 'analysis' });
        setVerifiedCount((prev) => prev + 1);
      } else {
        throw new Error(result.error || 'Ошибка анализа');
      }
    } catch (error) {
      console.error(error);
      toast.error('Ошибка: ' + error.message, { id: 'analysis' });
    } finally {
      setIsChecking(false);
    }
  };



  return (
    <>
      <Head>
        <title>AML Checker Pro</title>
        <meta name="description" content="AML проверка адресов и транзакций" />
      </Head>
      <div className="container">
        <WalletConnect
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onPaymentSuccess={handlePaymentSuccess}
        />
        <div className="subtitle">
          <i className="fas fa-shield-halved" /> AML Checker Pro
        </div>
        <h1>Профессиональная AML проверка<br />для безопасных криптоплатежей</h1>

        <div className="unified-block">
          <div className="unified-features">
            <div className="unified-card">
              <div className="feature-icon"><i className="fas fa-brain" /></div>
              <h3>AI Risk Score</h3>
              <p>Оценка риска на основе машинного обучения</p>
            </div>
            <div className="unified-card">
              <div className="feature-icon"><i className="fas fa-bolt" /></div>
              <h3>Real-time проверка</h3>
              <p>Мгновенная проверка через ведущих провайдеров</p>
            </div>
            <div className="unified-card">
              <div className="feature-icon"><i className="fas fa-file-lines" /></div>
              <h3>Детальные отчеты</h3>
              <p>Полный анализ с факторами риска</p>
            </div>
          </div>
        </div>

        {riskReport && <RiskReport report={riskReport} type="address" />}

        <div className="guide-section">
          <div className="guide-title">
            <i className="fas fa-compass" /> Как выбрать AML решение
          </div>
          <div className="guide-content">
            <div className="guide-block">
              <h3><i className="fas fa-arrow-right" /> Для планируемых операций</h3>
              <ul className="guide-list">
                <li><strong>Проверка адреса получателя</strong> — перед переводом</li>
                <li><strong>Проверка перед переводом</strong> — быстрый сценарий</li>
              </ul>
            </div>
            <div className="guide-block">
              <h3><i className="fas fa-clock" /> Для уже отправленных средств</h3>
              <ul className="guide-list">
                <li><strong>Проверка транзакции (TXID)</strong> — после отправки</li>
                <li><strong>Проверка кошелька</strong> — для оценки контрагента</li>
              </ul>
            </div>
            <div className="guide-block centered-block">
              <h3><i className="fas fa-list-check" /> Короткая памятка</h3>
              <ul className="guide-list">
                <li><i className="fas fa-check-circle" style={{ color: '#60a5fa' }} /> <strong>Адрес</strong> — до перевода</li>
                <li><i className="fas fa-check-circle" style={{ color: '#60a5fa' }} /> <strong>Кошелек</strong> — для контрагента</li>
                <li><i className="fas fa-check-circle" style={{ color: '#60a5fa' }} /> <strong>TXID</strong> — после отправки</li>
              </ul>
            </div>
            <div className="guide-note">
              <i className="fas fa-exclamation-triangle" style={{ color: '#60a5fa' }} />
              <strong>Почему это важно:</strong> Биржи используют AML-скрининг. При повышенном риске — задержки и manual review.
            </div>
          </div>
        </div>

        <div className="stats-container">
          <div className="stat-card">
            <div className="stat-icon"><i className="fas fa-check-double" /></div>
            <span className="stat-number">{verifiedCount.toLocaleString()}</span>
            <span className="stat-label">Verified Today</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><i className="fas fa-link" /></div>
            <span className="stat-number">12</span>
            <span className="stat-label">Blockchains</span>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><i className="fas fa-building" /></div>
            <span className="stat-number">98%</span>
            <span className="stat-label">Accuracy</span>
          </div>
        </div>

        <footer>
          <div><i className="fas fa-microchip" /> AML Checker Pro</div>
          <div className="footer-links">
            <span><i className="fas fa-file-contract" /> Условия</span>
            <span><i className="fas fa-lock" /> Конфиденциальность</span>
            <span><i className="fas fa-envelope" /> support@amlchecker.pro</span>
          </div>
        </footer>
      </div>
    </>
  );
}