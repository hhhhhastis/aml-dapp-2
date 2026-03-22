// pages/api/pay.js

const TRONGRID_URL         = process.env.NEXT_PUBLIC_TRONGRID_URL || 'https://nile.trongrid.io';
const AML_CONTRACT         = process.env.NEXT_PUBLIC_AML_CONTRACT;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const ABI = [
  {
    name: 'pay',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAllowance',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'feeAmount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userAddress } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: 'userAddress обязателен' });
  }
  if (!DEPLOYER_PRIVATE_KEY) {
    return res.status(500).json({ error: 'DEPLOYER_PRIVATE_KEY не настроен' });
  }
  if (!AML_CONTRACT) {
    return res.status(500).json({ error: 'AML_CONTRACT не настроен' });
  }

  try {
    const TronWebModule = await import('tronweb');
    const TronWeb = TronWebModule.TronWeb
      ?? TronWebModule.default?.TronWeb
      ?? TronWebModule.default
      ?? TronWebModule;

    const tronWeb = new TronWeb({
      fullHost:   TRONGRID_URL,
      privateKey: DEPLOYER_PRIVATE_KEY,
    });

    // ── Диагностика ──────────────────────────────────────────────
    console.log('[pay] TRONGRID_URL:', TRONGRID_URL);
    console.log('[pay] AML_CONTRACT:', AML_CONTRACT);
    console.log('[pay] DEPLOYER_KEY set:', !!DEPLOYER_PRIVATE_KEY);
    console.log('[pay] tronWeb.defaultAddress:', tronWeb.defaultAddress?.base58);
    console.log('[pay] userAddress:', userAddress);

    // ── Проверяем что контракт существует ────────────────────────
    const contractInfo = await tronWeb.trx.getContract(AML_CONTRACT);
    console.log('[pay] contractInfo bytecode exists:', !!contractInfo?.bytecode);

    if (!contractInfo?.bytecode) {
      return res.status(500).json({
        error: 'Контракт не найден по адресу: ' + AML_CONTRACT,
      });
    }

    // ── Читаем allowance через triggerConstantContract ────────────
    const rawAllowance = await tronWeb.transactionBuilder.triggerConstantContract(
      AML_CONTRACT,
      'getAllowance(address)',
      {},
      [{ type: 'address', value: userAddress }],
      tronWeb.defaultAddress.base58
    );

    console.log('[pay] rawAllowance:', JSON.stringify(rawAllowance));

    const allowance = rawAllowance.constant_result?.[0]
      ? BigInt('0x' + rawAllowance.constant_result[0])
      : BigInt(0);

    console.log('[pay] allowance (parsed):', allowance.toString());

    // ── Читаем feeAmount через triggerConstantContract ────────────
    const rawFee = await tronWeb.transactionBuilder.triggerConstantContract(
      AML_CONTRACT,
      'feeAmount()',
      {},
      [],
      tronWeb.defaultAddress.base58
    );

    console.log('[pay] rawFee:', JSON.stringify(rawFee));

    const feeAmount = rawFee.constant_result?.[0]
      ? BigInt('0x' + rawFee.constant_result[0])
      : BigInt(0);

    console.log('[pay] feeAmount (parsed):', feeAmount.toString());

    // ── Сравниваем allowance и feeAmount ─────────────────────────
    if (allowance === BigInt(0)) {
      return res.status(400).json({
        error: 'Allowance = 0. Сначала выполни approve.',
        allowance: allowance.toString(),
        feeAmount: feeAmount.toString(),
      });
    }

    if (allowance < feeAmount) {
      return res.status(400).json({
        error: `Недостаточно allowance. Есть: ${allowance}, нужно: ${feeAmount}`,
        allowance: allowance.toString(),
        feeAmount: feeAmount.toString(),
      });
    }

    // ── Симулируем вызов pay() ────────────────────────────────────
    const simulation = await tronWeb.transactionBuilder.triggerConstantContract(
      AML_CONTRACT,
      'pay(address)',
      {},
      [{ type: 'address', value: userAddress }],
      tronWeb.defaultAddress.base58
    );

    console.log('[pay] simulation:', JSON.stringify(simulation));

    if (!simulation.result?.result) {
      const revertMsg = simulation.result?.message
        ? tronWeb.toUtf8(simulation.result.message)
        : 'Unknown revert reason';
      return res.status(400).json({
        error: 'Симуляция упала: ' + revertMsg,
        simulation,
        allowance: allowance.toString(),
        feeAmount: feeAmount.toString(),
      });
    }

    // ── Вызываем pay() ────────────────────────────────────────────
    console.log('[pay] вызываем pay() для', userAddress);

    const contract = await tronWeb.contract(ABI, AML_CONTRACT);
    const tx = await contract.pay(userAddress).send({
      feeLimit:  100_000_000, // 100 TRX
      callValue: 0,
    });

    console.log('[pay] txid:', tx);
    return res.status(200).json({
      success: true,
      txid: tx,
      allowance: allowance.toString(),
      feeAmount: feeAmount.toString(),
    });

  } catch (err) {
    console.error('[pay] ошибка:', err);
    return res.status(500).json({
      error: err.message || 'Внутренняя ошибка сервера',
    });
  }
}