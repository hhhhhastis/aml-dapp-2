import { useState } from 'react';
import toast from 'react-hot-toast';
import TronWeb from 'tronweb';

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RECIPIENT_ADDRESS = process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || 'TВашАдрес';
const AMOUNT = 1.29;

export default function PaymentModal({ isOpen, onClose, onSuccess, walletAddress }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [status, setStatus] = useState(null);

  if (!isOpen) return null;

  const handlePayment = async () => {
    if (!window.tronWeb) {
      toast.error('Кошелёк не подключён');
      return;
    }

    setIsProcessing(true);
    setStatus('init');

    try {
      const tronWeb = window.tronWeb;
      const usdtContract = await tronWeb.contract().at(USDT_CONTRACT);

      // Проверка баланса USDT
      const balance = await usdtContract.balanceOf(walletAddress).call();
      const usdtBalance = tronWeb.fromSun(balance.toString()) / 1e6;
      if (usdtBalance < AMOUNT) {
        toast.error(`Недостаточно USDT. Баланс: ${usdtBalance.toFixed(2)} USDT`);
        setIsProcessing(false);
        return;
      }

      setStatus('sending');
      const amountInSun = Math.floor(AMOUNT * 1e6);
      const tx = await usdtContract.transfer(RECIPIENT_ADDRESS, amountInSun).send();
      setTxHash(tx);
      setStatus('waiting');

      // Ожидание подтверждения
      let confirmed = false;
      let attempts = 0;
      while (!confirmed && attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const txInfo = await tronWeb.trx.getTransactionInfo(tx);
          if (txInfo && txInfo.result === 'SUCCESS') confirmed = true;
        } catch (e) {
          // транзакция ещё не подтверждена
        }
        attempts++;
      }

      if (confirmed) {
        setStatus('success');
        toast.success('Платёж подтверждён!');
        onSuccess(tx);
      } else {
        setStatus('pending');
        toast.success('Транзакция отправлена, ожидает подтверждения');
        onSuccess(tx);
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      toast.error(err.message || 'Ошибка платежа');
    } finally {
      setIsProcessing(false);
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
        {status && (
          <div className="transaction-status">
            {status === 'init' && <><div className="spinner" /> Подготовка...</>}
            {status === 'sending' && <><div className="spinner" /> Отправка транзакции...</>}
            {status === 'waiting' && <><div className="spinner" /> Ожидание подтверждения...</>}
            {status === 'success' && <><i className="fas fa-check-circle" /> Платёж подтверждён!</>}
            {status === 'pending' && <><i className="fas fa-hourglass-half" /> Транзакция отправлена, ожидает подтверждения</>}
            {status === 'error' && <><i className="fas fa-exclamation-circle" /> Ошибка</>}
          </div>
        )}
        <div className="payment-buttons">
          <button className="payment-button secondary" onClick={onClose} disabled={isProcessing}>Отмена</button>
          <button className="payment-button primary" onClick={handlePayment} disabled={isProcessing}>
            {isProcessing ? 'Обработка...' : `Оплатить ${AMOUNT} USDT`}
          </button>
        </div>
        <p><i className="fas fa-info-circle" /> Транзакция будет выполнена в сети TRON. Убедитесь, что у вас есть TRX для комиссии.</p>
      </div>
    </div>
  );
}