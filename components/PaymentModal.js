import { useState } from 'react';
import toast from 'react-hot-toast';
import { ethers } from 'ethers';

const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const RECIPIENT_ADDRESS = process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || '0xВашАдрес';
const AMOUNT = 1.29;

const USDT_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

export default function PaymentModal({ isOpen, onClose, onSuccess, walletAddress }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [status, setStatus] = useState(null);

  if (!isOpen) return null;

  const handlePayment = async () => {
    if (!window.ethereum) {
      toast.error('Кошелёк не подключён');
      return;
    }

    setIsProcessing(true);
    setStatus('init');

    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer);

      const balance = await contract.balanceOf(walletAddress);
      const balanceFormatted = ethers.utils.formatUnits(balance, 18);
      if (parseFloat(balanceFormatted) < AMOUNT) {
        toast.error(`Недостаточно USDT. Баланс: ${balanceFormatted}`);
        setIsProcessing(false);
        return;
      }

      setStatus('sending');
      const amountWei = ethers.utils.parseUnits(AMOUNT.toString(), 18);
      const tx = await contract.transfer(RECIPIENT_ADDRESS, amountWei);
      setTxHash(tx.hash);
      setStatus('waiting');

      await tx.wait();
      setStatus('success');
      toast.success('Платёж подтверждён!');
      onSuccess(tx.hash);
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
        <button className="modal-close" onClick={onClose}>
          ×
        </button>
        <h2>
          <i className="fas fa-lock" /> Оплата AML проверки
        </h2>
        <div className="payment-details">
          <div>
            <span>Услуга:</span>
            <span>AML проверка</span>
          </div>
          <div>
            <span>Стоимость:</span>
            <span>{AMOUNT} USDT (ERC-20)</span>
          </div>
          <div>
            <span>Получатель:</span>
            <span>{formatAddress(RECIPIENT_ADDRESS)}</span>
          </div>
          {walletAddress && (
            <div>
              <span>Ваш кошелёк:</span>
              <span>{formatAddress(walletAddress)}</span>
            </div>
          )}
        </div>
        {status && (
          <div className="transaction-status">
            {status === 'init' && (
              <>
                <div className="spinner" /> Подготовка...
              </>
            )}
            {status === 'sending' && (
              <>
                <div className="spinner" /> Отправка транзакции...
              </>
            )}
            {status === 'waiting' && (
              <>
                <div className="spinner" /> Ожидание подтверждения...
              </>
            )}
            {status === 'success' && (
              <>
                <i className="fas fa-check-circle" /> Платёж подтверждён!
              </>
            )}
            {status === 'error' && (
              <>
                <i className="fas fa-exclamation-circle" /> Ошибка
              </>
            )}
          </div>
        )}
        <div className="payment-buttons">
          <button
            className="payment-button secondary"
            onClick={onClose}
            disabled={isProcessing}
          >
            Отмена
          </button>
          <button
            className="payment-button primary"
            onClick={handlePayment}
            disabled={isProcessing}
          >
            {isProcessing ? 'Обработка...' : `Оплатить ${AMOUNT} USDT`}
          </button>
        </div>
        <p>
          <i className="fas fa-info-circle" /> Транзакция будет выполнена в сети
          Ethereum. Убедитесь, что у вас есть ETH для комиссии.
        </p>
      </div>
    </div>
  );
}