const solc = require('solc');
const fs   = require('fs');

const source = fs.readFileSync('AMLPayment.sol', 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'AMLPayment.sol': { content: source } },
  settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } } }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

// Выводим ошибки если есть
if (output.errors) {
  output.errors.forEach(e => console.error(e.formattedMessage));
}

const contracts = output.contracts?.['AMLPayment.sol'];
if (!contracts || !contracts['AMLPayment']) {
  console.error('Контракт не скомпилировался. Смотри ошибки выше.');
  process.exit(1);
}

const contract = contracts['AMLPayment'];
fs.writeFileSync('abi.json',     JSON.stringify(contract.abi, null, 2));
fs.writeFileSync('bytecode.txt', contract.evm.bytecode.object);

console.log('✅ Компиляция успешна!');

