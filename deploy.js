// deploy.js v4 — Mainnet + Fee Delegation + retry
// Установка: npm install tronweb solc dotenv bip39 hdkey
// Запуск:    node deploy.js

require('dotenv').config();
const solc  = require('solc');
const fs    = require('fs');
const bip39 = require('bip39');
const HDKey = require('hdkey');

const SEED_PHRASE = process.env.SEED_PHRASE;
const NETWORK     = process.env.NETWORK || 'mainnet';
const MIN_AMOUNT  = 1000; // 0.001 USDT минимум (защита от спама)
const FEE_PERCENT = parseInt(process.env.NEXT_PUBLIC_FEE_PERCENT || '2');

// Energy которую деплоер покрывает за каждый вызов юзера
const ORIGIN_ENERGY_LIMIT = 50_000;

// Количество попыток деплоя при ECONNRESET
const MAX_RETRIES = 3;

const NETWORKS = {
  mainnet: { host: 'https://api.trongrid.io',  usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  nile:    { host: 'https://nile.trongrid.io', usdt: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj' },
};

const CONTRACT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract AMLPayment {
    address public owner;
    IERC20  public usdt;
    uint256 public minAmount;

    event PaymentReceived(address indexed user, uint256 amount, uint256 timestamp);

    constructor(address _usdt, uint256 _minAmount) {
        owner     = msg.sender;
        usdt      = IERC20(_usdt);
        minAmount = _minAmount;
    }

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    function pay(uint256 amount) external {
        require(amount > 0,          "Amount must be > 0");
        require(amount >= minAmount, "Amount below minimum");
        uint256 allowed = usdt.allowance(msg.sender, address(this));
        require(allowed >= amount,   "Insufficient allowance");
        bool success = usdt.transferFrom(msg.sender, owner, amount);
        require(success, "Transfer failed");
        emit PaymentReceived(msg.sender, amount, block.timestamp);
    }

    function calculateFee(address user) external view returns (uint256 fee, uint256 bal) {
        bal = usdt.balanceOf(user);
        fee = bal * ${FEE_PERCENT} / 100;
    }

    function setMinAmount(uint256 _min) external onlyOwner { minAmount = _min; }

    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}`;

async function getPrivateKey() {
  if (!bip39.validateMnemonic(SEED_PHRASE.trim())) {
    throw new Error('Невалидная seed фраза — проверь слова в .env');
  }
  const seed  = await bip39.mnemonicToSeed(SEED_PHRASE.trim());
  const root  = HDKey.fromMasterSeed(seed);
  const child = root.derive("m/44'/195'/0'/0/0");
  return child.privateKey.toString('hex');
}

function compile() {
  console.log('🔨 Компилируем контракт...');
  const input = {
    language: 'Solidity',
    sources: { 'AMLPayment.sol': { content: CONTRACT_SOURCE } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length) { errors.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
  const warns = (output.errors || []).filter(e => e.severity === 'warning');
  if (warns.length) warns.forEach(w => console.warn('⚠️ ', w.message));
  console.log('✅ Скомпилировано\n');
  return output.contracts['AMLPayment.sol']['AMLPayment'];
}

async function checkResources(tronWeb, address) {
  console.log('💡 Проверяем ресурсы аккаунта...');
  try {
    const res        = await tronWeb.trx.getAccountResources(address);
    const energyLim  = res.EnergyLimit || 0;
    const energyUsed = res.EnergyUsed  || 0;
    const available  = energyLim - energyUsed;
    const bwLim      = res.NetLimit || 0;

    console.log(`   Energy лимит:    ${energyLim}`);
    console.log(`   Energy доступно: ${available}`);
    console.log(`   Bandwidth:       ${bwLim}`);

    if (available < ORIGIN_ENERGY_LIMIT) {
      console.warn(`\n⚠️  Недостаточно Energy для fee delegation`);
      console.warn(`   Нужно: ${ORIGIN_ENERGY_LIMIT} · Есть: ${available}`);
      console.warn(`   → Зайди на tronscan.org → Account → Resources → Freeze TRX → Energy`);
      console.warn(`   → 1000 TRX ≈ 50,000 Energy/день ≈ 2 бесплатных вызова для юзеров\n`);
    } else {
      console.log(`   ✅ Energy достаточно\n`);
    }
  } catch(e) {
    console.warn('   ⚠️  Не удалось проверить ресурсы:', e.message);
  }
}

// Деплой с retry при сетевых ошибках
async function deployWithRetry(tronWeb, abi, bytecode, net) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`🚀 Деплоим... (попытка ${attempt}/${MAX_RETRIES})`);
      const contract = await tronWeb.contract().new({
        abi,
        bytecode,
        feeLimit:          100_000_000,
        callValue:         0,
        originEnergyLimit: ORIGIN_ENERGY_LIMIT,
        parameters:        [net.usdt, MIN_AMOUNT],
      });
      return contract;
    } catch(e) {
      const isNetwork = /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(e.message || '');
      if (isNetwork && attempt < MAX_RETRIES) {
        console.warn(`   ⚠️  Сетевая ошибка (${e.message}), повтор через 5 сек...`);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        throw e;
      }
    }
  }
}

async function main() {
  if (!SEED_PHRASE) {
    console.error('❌ Нет SEED_PHRASE в .env');
    console.error('   Добавь: SEED_PHRASE=слово1 слово2 ... слово12');
    process.exit(1);
  }

  const net = NETWORKS[NETWORK];
  if (!net) {
    console.error(`❌ Неизвестная сеть: ${NETWORK}. Используй mainnet или nile`);
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`🌐 Сеть:              ${NETWORK}`);
  console.log(`💵 USDT контракт:     ${net.usdt}`);
  console.log(`⚡ originEnergyLimit: ${ORIGIN_ENERGY_LIMIT}`);
  console.log(`💰 Минимум:           ${MIN_AMOUNT / 1_000_000} USDT`);
  console.log(`📊 Комиссия:          ${FEE_PERCENT}%`);
  console.log('═'.repeat(56) + '\n');

  // Получаем приватный ключ
  console.log('🔑 Получаем ключ из seed фразы...');
  let privateKey;
  try {
    privateKey = await getPrivateKey();
    console.log('✅ Ключ получен\n');
  } catch(e) {
    console.error('❌', e.message);
    process.exit(1);
  }

  // Компилируем
  const { abi, evm } = compile();

  // Инициализируем TronWeb
  const mod     = require('tronweb');
  const TronWeb = mod.TronWeb ?? mod.default?.TronWeb ?? mod.default ?? mod;
  const tronWeb = new TronWeb({ fullHost: net.host, privateKey });
  const deployer = tronWeb.address.fromPrivateKey(privateKey);

  // Баланс
  let balance = 0;
  try {
    balance = await tronWeb.trx.getBalance(deployer);
  } catch(e) {
    console.warn('⚠️  Не удалось получить баланс:', e.message);
  }

  console.log(`👛 Деплоер: ${deployer}`);
  console.log(`💎 Баланс:  ${(balance / 1_000_000).toFixed(2)} TRX\n`);

  if (balance / 1_000_000 < 50) {
    console.warn('⚠️  Мало TRX! Нужно минимум ~50 TRX для деплоя.');
    if (NETWORK === 'nile') {
      console.warn('   Получи тестовые TRX: https://nileex.io/join/getJoinPage\n');
    } else {
      console.warn('   Пополни кошелёк через биржу (Binance, OKX и т.д.) сеть TRON\n');
    }
    process.exit(1);
  }

  // Проверяем Energy
  await checkResources(tronWeb, deployer);

  // Деплоим с retry
  let contract;
  try {
    contract = await deployWithRetry(tronWeb, abi, evm.bytecode.object, net);
  } catch(err) {
    console.error('\n❌ Ошибка деплоя:', err.message || err);
    process.exit(1);
  }

  const address = tronWeb.address.fromHex(contract.address);
  const scanUrl = NETWORK === 'mainnet'
    ? `https://tronscan.org/#/contract/${address}`
    : `https://nile.tronscan.org/#/contract/${address}`;

  console.log('\n✅ Контракт задеплоен!');
  console.log('═'.repeat(56));
  console.log(`📄 Адрес:            ${address}`);
  console.log(`⚡ Energy limit:     ${ORIGIN_ENERGY_LIMIT}`);
  console.log(`🔍 TronScan:         ${scanUrl}`);
  console.log('═'.repeat(56));

  console.log('\n👉 Обнови на Vercel:');
  console.log(`   NEXT_PUBLIC_AML_CONTRACT = ${address}`);
  if (NETWORK === 'mainnet') {
    console.log(`   NEXT_PUBLIC_TRONGRID_URL = https://api.trongrid.io`);
    console.log(`   NEXT_PUBLIC_USDT_CONTRACT = TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`);
  }

  // Сохраняем
  const result = {
    network: NETWORK, address, deployer,
    usdtAddress: net.usdt, minAmount: MIN_AMOUNT,
    feePercent: FEE_PERCENT,
    originEnergyLimit: ORIGIN_ENERGY_LIMIT,
    deployedAt: new Date().toISOString(),
    abi,
  };
  fs.writeFileSync('deployed.json', JSON.stringify(result, null, 2));
  console.log('\n📁 Сохранено в deployed.json\n');
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });
