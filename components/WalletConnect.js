import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';

// ─── НАСТРОЙКА ────────────────────────────────────────────────────────────────
const WC_PROJECT_ID       = '7a01fc0d75597c9ec6bb51608ad91767';
const TRON_USDT_CONTRACT  = process.env.NEXT_PUBLIC_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const TRON_AML_CONTRACT   = process.env.NEXT_PUBLIC_AML_CONTRACT  || 'THG9SQhxa6knVqkvQwmMHfwPsMtzvaVoTc';
const TRON_PAYMENT_AMOUNT = 1_290_000; // 1.29 USDT
const TRONGRID_URL        = process.env.NEXT_PUBLIC_TRONGRID_URL  || 'https://nile.trongrid.io';
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// TRONGRID API
// ══════════════════════════════════════════════════════════════════════════════

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

const tronHeaders = () => ({ 'Content-Type': 'application/json' });

const getUsdtBalance = async (address) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     address,
      contract_address:  TRON_USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         encodeAddress(address).padStart(64, '0'),
      visible:           true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return Number(BigInt('0x' + (hex || '0'))) / 1_000_000;
};

const checkAllowanceRaw = async (userAddress) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     userAddress,
      contract_address:  TRON_USDT_CONTRACT,
      function_selector: 'allowance(address,address)',
      parameter:
        encodeAddress(userAddress).padStart(64, '0') +
        encodeAddress(TRON_AML_CONTRACT).padStart(64, '0'),
      visible: true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return BigInt('0x' + (hex || '0'));
};

// Строим approve(AML_CONTRACT, PAYMENT_AMOUNT)
const buildApproveTx = async (fromBase58) => {
  const ownerHex    = '41' + encodeAddress(fromBase58);
  const contractHex = '41' + encodeAddress(TRON_USDT_CONTRACT);
  const spenderHex  = encodeAddress(TRON_AML_CONTRACT).padStart(64, '0');
  const amountHex   = TRON_PAYMENT_AMOUNT.toString(16).padStart(64, '0');
  const res = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify({
      owner_address:     ownerHex,
      contract_address:  contractHex,
      function_selector: 'approve(address,uint256)',
      parameter:         spenderHex + amountHex,
      fee_limit:         10_000_000,
      call_value:        0,
      visible:           false,
    }),
  });
  const data = await res.json();
  if (!data?.transaction) throw new Error('buildApproveTx: ' + (data?.Error ?? JSON.stringify(data)));
  return data.transaction;
};

const broadcastTx = async (signedTx) => {
  const res = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
    method: 'POST', headers: tronHeaders(),
    body: JSON.stringify(signedTx),
  });
  const data = await res.json();
  if (!data?.result) throw new Error('broadcast: ' + (data?.message ?? JSON.stringify(data)));
  return data.txid;
};

// Серверный вызов pay()
const callServerPay = async (userAddress) => {
  const res = await fetch('/api/pay', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userAddress }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data.txid;
};

// ══════════════════════════════════════════════════════════════════════════════
// WALLETCONNECT
// ══════════════════════════════════════════════════════════════════════════════

const initWalletConnect = async () => {
  const { SignClient }         = await import('@walletconnect/sign-client');
  const { WalletConnectModal } = await import('@walletconnect/modal');

  const client = await SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'AML Checker', description: 'TRC-20 Risk Score',
      url:  window.location.origin,
      icons: [window.location.origin + '/favicon.ico'],
    },
  });

  const modal = new WalletConnectModal({
    projectId: WC_PROJECT_ID,
    themeMode: 'dark',
    themeVariables: { '--wcm-accent-color': '#3b82f6' },
    explorerRecommendedWalletIds: [
      '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
    ],
  });

  const { uri, approval } = await client.connect({
    optionalNamespaces: {
      tron: {
        methods: ['tron_signTransaction', 'tron_signMessage'],
        chains:  ['tron:0x2b6653dc'],
        events:  [],
      },
    },
  });

  if (uri) modal.openModal({ uri });
  let session;
  try   { session = await approval(); }
  finally { modal.closeModal(); }

  console.log('[WC] namespaces:', JSON.stringify(session.namespaces));

  const accounts = session.namespaces?.tron?.accounts ?? [];
  if (!accounts.length) throw new Error('Кошелёк не вернул TRON аккаунт.');
  return { client, session, address: accounts[0].split(':')[2] };
};

const unwrapSigned = (r) => {
  if (!r) return null;
  if (r.signature || r.txID) return r;
  if (r.result?.signature || r.result?.txID) return r.result;
  return null;
};

const signViaWC = async (client, session, tx) => {
  const tronAddress = session.namespaces?.tron?.accounts?.[0]?.split(':')[2];
  const attempts = [
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: { transaction: tx } } }),
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: [tx] } }),
    () => client.request({ topic: session.topic, chainId: 'tron:0x2b6653dc', request: { method: 'tron_signTransaction', params: { transaction: tx, address: tronAddress } } }),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const response = await attempt();
      console.log('[WC] sign response:', JSON.stringify(response));
      const signed = unwrapSigned(response);
      if (signed) return signed;
      if (response?.raw_data || response?.raw_data_hex) return response;
    } catch (e) {
      lastErr = e;
      console.warn('[WC failed]', e.code, e.message);
      if (e.code === 4001 || /reject|cancel|denied/i.test(e.message ?? '')) throw e;
      if (e.message?.includes('Unknown method') || e.code === -32601) continue;
      throw e;
    }
  }
  throw new Error('WC подпись не удалась.\n' + (lastErr?.message ?? ''));
};

// ══════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТ
// ══════════════════════════════════════════════════════════════════════════════

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0,
    }} />
  );
}

export default function WalletConnect({ onConnect, onDisconnect, onPaymentSuccess }) {
  const [address,      setAddress]      = useState(null);
  const [connecting,   setConnecting]   = useState(false);
  const [approving,    setApproving]    = useState(false);
  const [paying,       setPaying]       = useState(false);
  const [hasAllowance, setHasAllowance] = useState(false);
  const [txHash,       setTxHash]       = useState(null);
  const [balance,      setBalance]      = useState(null);

  const sessionRef = useRef({ client: null, session: null });

  const fmt    = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;
  const isBusy = connecting || approving || paying;

  // Проверяем allowance при смене адреса
  useEffect(() => {
    if (!address) return;
    checkAllowanceRaw(address)
      .then(al => setHasAllowance(al >= BigInt(TRON_PAYMENT_AMOUNT)))
      .catch(() => setHasAllowance(false));
    getUsdtBalance(address)
      .then(b => setBalance(b))
      .catch(() => setBalance(null));
  }, [address]);

  // ─── Подключение через WalletConnect ──────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      const wc = await initWalletConnect();
      sessionRef.current = { client: wc.client, session: wc.session };

      wc.client.on('session_delete', () => { sessionRef.current = {}; handleDisconnect(); });
      wc.client.on('session_expire',  () => { sessionRef.current = {}; handleDisconnect(); });

      setAddress(wc.address);
      onConnect?.(wc.address);
      toast.success('Кошелёк подключён ✓');
    } catch (err) {
      console.error('[connect]', err);
      const isRejected = /reject|cancel|closed/i.test(err.message ?? '');
      if (!isRejected) toast.error(err.message || 'Ошибка подключения');
    } finally {
      setConnecting(false);
    }
  };

  // ─── Approve — юзер подписывает разрешение ────────────────────────────────
  const handleApprove = async () => {
    const { client, session } = sessionRef.current;
    if (!client || !session) return toast.error('Кошелёк не подключён');

    // Проверяем баланс
    const bal = await getUsdtBalance(address).catch(() => 0);
    if (bal < TRON_PAYMENT_AMOUNT / 1_000_000) {
      return toast.error(`Недостаточно USDT.\nНужно: ${(TRON_PAYMENT_AMOUNT / 1_000_000).toFixed(2)} · Доступно: ${bal.toFixed(6)}`);
    }

    setApproving(true);
    const tid = toast.loading('Подпиши approve в кошельке…');
    try {
      const approveTx   = await buildApproveTx(address);
      const signed      = await signViaWC(client, session, approveTx);
      const approveTxid = await broadcastTx(signed);
      toast.dismiss(tid);
      toast.success('Approve подтверждён ✓');
      console.log('[approve] txid:', approveTxid);
      setHasAllowance(true);
    } catch (err) {
      toast.dismiss(tid);
      const isRejected = /reject|cancel|denied/i.test(err.message ?? '');
      toast.error(isRejected ? 'Отклонено' : 'Ошибка approve: ' + err.message);
    } finally {
      setApproving(false);
    }
  };

  // ─── Pay — сервер вызывает pay() автоматически ────────────────────────────
  const handlePay = async () => {
    if (!hasAllowance) return toast.error('Сначала выполни approve');
    setPaying(true);
    const tid = toast.loading('Сервер выполняет оплату…');
    try {
      const txid = await callServerPay(address);
      toast.dismiss(tid);
      toast.success(`Оплата прошла! TX: ${txid.slice(0, 14)}…`, { duration: 6000 });
      console.log('[pay] txid:', txid);
      setTxHash(txid);
      onPaymentSuccess?.(txid, address);
    } catch (err) {
      toast.dismiss(tid);
      toast.error('Ошибка оплаты: ' + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleDisconnect = () => {
    const { client, session } = sessionRef.current;
    if (client && session) {
      client.disconnect({ topic: session.topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {});
    }
    sessionRef.current = {};
    setAddress(null);
    setTxHash(null);
    setHasAllowance(false);
    setBalance(null);
    onDisconnect?.();
  };

  // ─── Не подключён ─────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: '2rem', gap: '0.5rem' }}>
        <button onClick={handleConnect} disabled={connecting} style={btnStyle(connecting, '#3b82f6')}>
          {connecting ? <Spinner /> : <i className="fas fa-wallet" />}
          {connecting ? 'Подключение...' : 'Подключить кошелёк'}
        </button>
      </div>
    );
  }

  // ─── Подключён ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>

        {/* Бейдж адреса */}
        <div style={badgeStyle}>
          <i className="fas fa-check-circle" style={{ color: '#10b981' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{fmt(address)}</div>
            {balance !== null && (
              <div style={{ fontSize: '0.65rem', color: '#a0b3d9' }}>
                USDT: {balance.toFixed(2)}
              </div>
            )}
            {txHash ? (
              <a href={`https://nile.tronscan.org/#/transaction/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.72rem', color: '#10b981', textDecoration: 'none' }}>
                ✓ Оплачено · NileScan ↗
              </a>
            ) : (
              <div style={{ fontSize: '0.72rem', color: '#f59e0b' }}>⏳ Ожидание оплаты</div>
            )}
          </div>
          <button onClick={handleDisconnect} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
            <i className="fas fa-sign-out-alt" />
          </button>
        </div>

        {/* Кнопки approve / pay */}
        {!txHash && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>

            {/* Кнопка Approve — только если ещё нет allowance */}
            {!hasAllowance && (
              <button onClick={handleApprove} disabled={isBusy} style={btnStyle(isBusy, '#3b82f6')}>
                {approving ? <Spinner size={14} /> : <i className="fas fa-check" />}
                {approving ? 'Ожидание...' : 'Разрешить оплату'}
              </button>
            )}

            {/* Кнопка Pay — активна только после approve */}
            <button onClick={handlePay} disabled={isBusy || !hasAllowance} style={btnStyle(isBusy || !hasAllowance, hasAllowance ? '#10b981' : '#6b7280')}>
              {paying ? <Spinner size={14} /> : <i className="fas fa-paper-plane" />}
              {paying ? 'Обработка...' : `Оплатить $${(TRON_PAYMENT_AMOUNT / 1_000_000).toFixed(2)}`}
            </button>

          </div>
        )}

        {/* Статус если идёт процесс */}
        {(approving || paying) && (
          <div style={{ fontSize: '0.8rem', color: '#a0b3d9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Spinner size={12} />
            {approving && 'Подпиши approve в кошельке…'}
            {paying    && 'Сервер выполняет pay()…'}
          </div>
        )}

      </div>
    </div>
  );
}

const btnStyle = (disabled, bg = '#3b82f6') => ({
  background: disabled ? '#4b5563' : bg,
  color: 'white', border: 'none', borderRadius: '40px',
  padding: '0.7rem 1.5rem', fontSize: '0.9rem', fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex', alignItems: 'center', gap: '0.6rem',
  opacity: disabled ? 0.6 : 1, transition: 'all 0.2s',
});

const badgeStyle = {
  background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
  borderRadius: '40px', padding: '0.8rem 1.5rem',
  display: 'flex', alignItems: 'center', gap: '1rem',
};
