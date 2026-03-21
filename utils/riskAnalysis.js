export const analyzeAddress = async (address) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const riskScore = Math.floor(Math.random() * 100);
  const riskLevel = riskScore < 30 ? 'low' : riskScore < 70 ? 'medium' : 'high';

  return {
    success: true,
    address,
    riskScore,
    riskLevel,
    timestamp: new Date().toISOString(),
  };
};

export const analyzeTransaction = async (txid) => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const riskScore = Math.floor(Math.random() * 100);
  const riskLevel = riskScore < 30 ? 'low' : riskScore < 70 ? 'medium' : 'high';

  return {
    success: true,
    txid,
    riskScore,
    riskLevel,
    timestamp: new Date().toISOString(),
  };
};