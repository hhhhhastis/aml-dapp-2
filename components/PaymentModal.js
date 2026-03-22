import { useState } from 'react';
import toast from 'react-hot-toast';

const RECIPIENT_ADDRESS = process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || 'TВашАдрес';
const AMOUNT = 1.29;

export default function PaymentModal({ isOpen, onClose, onSuccess, walletAddress }) {
  const [checking, setChecking] = useState(false);

  if (!isOpen) return null;

  const checkPayment = async () => {
    setChecking(true);
    try {
      // Здесь нужно реализовать проверку через TronGrid, что на адрес RECIPIENT_ADDRESS
      // пришла транзакция от walletAddress на сумму AMOUNT USDT.
      // Для демо просто имитируем успех.
      await new Promise(r => setTimeout(r, 2000));
      const mockSuccess = true; // В реальности заменить на API вызов
      if (mockSuccess) {
        toast.success('Платёж подтверждён!');
        onSuccess('demo_tx_hash');
      } else {
        toast.error('Платёж не найден. Попробуйте ещё раз.');
      }
    } catch (err) {
      toast.error('Ошибка проверки платежа');
    } finally {
      setChecking(false);
    }
  };

  const formatAddress = (addr) => `${addr.slice(0, 8)}...${addr.slice(-6)}`;

  return (
    <div className="payment-modal-overlay" onClick={onClose}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2><i className="fas fa-lock" /> Оплата AML проверки</h2>
        <div className="payment-details">
          <div><span>Услуга:</span><span>AML проверка</span></div>
          <div><span>Стоимость:</span><span>{AMOUNT} USDT (TRC-20)</span></div>
          <div><span>Получатель:</span><span>{formatAddress(RECIPIENT_ADDRESS)}</span></div>
          {walletAddress && (
            <div><span>Ваш кошелёк:</span><span>{formatAddress(walletAddress)}</span></div>
          )}
        </div>
        <div style={{ textAlign: 'center', margin: '1rem 0' }}>
          <p>Отправьте <strong>{AMOUNT} USDT</strong> на указанный адрес.</p>
          <p>После оплаты нажмите кнопку «Я оплатил».</p>
        </div>
        <div className="payment-buttons">
          <button className="payment-button secondary" onClick={onClose}>Отмена</button>
          <button className="payment-button primary" onClick={checkPayment} disabled={checking}>
            {checking ? 'Проверка...' : 'Я оплатил'}
          </button>
        </div>
        <p><i className="fas fa-info-circle" /> Транзакция будет выполнена в сети TRON. Убедитесь, что у вас есть TRX для комиссии.</p>
      </div>
    </div>
  );
}