import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 7099;

// Enable CORS for the React app
app.use(cors());

// Stock name mapping
const A_STOCK_NAMES = {
  '600519': '贵州茅台',
  '600036': '招商银行',
  '000001': '平安银行',
  '601318': '中国平安',
  '600900': '长江电力',
  '000858': '五粮液',
  '600276': '恒瑞医药',
  '300750': '宁德时代',
  '601398': '工商银行',
  '601988': '中国银行',
  '601939': '建设银行',
  '601288': '农业银行',
  '600030': '中信证券',
  '600016': '民生银行',
  '600000': '浦发银行',
  '601166': '兴业银行',
};

// Format stock code
function formatStockCode(code) {
  const numCode = code.replace(/[^0-9]/g, '')
  if (numCode.startsWith('6')) return `sh${numCode}`
  if (numCode.startsWith('0') || numCode.startsWith('3')) return `sz${numCode}`
  return code
}

// Parse Tencent Finance data
function parseTencentData(dataStr, code) {
  try {
    const match = dataStr.match(/v_(\w+)=["'](.+?)["']/)
    if (!match) return null
    
    const fields = match[2].split('~')
    const stockCode = fields[2] || code
    const name = fields[1] || A_STOCK_NAMES[code] || code
    const price = parseFloat(fields[3]) || 0
    const change = parseFloat(fields[30]) || 0
    const changePercent = parseFloat(fields[31]) || 0
    
    return {
      code: stockCode.replace('sh', '').replace('sz', ''),
      name: name,
      price: price,
      change: change,
      changePercent: changePercent,
      timestamp: new Date().toISOString()
    }
  } catch (e) {
    console.error('Parse error:', e)
    return null
  }
}

// Stock quote endpoint
app.get('/stock/:code', async (req, res) => {
  const { code } = req.params;
  const formattedCode = formatStockCode(code);
  
  try {
    const response = await fetch(`http://qt.gtimg.cn/q=${formattedCode}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      return res.status(500).json({ error: 'Failed to fetch data' });
    }
    
    const text = await response.text();
    
    if (text && text.includes('=')) {
      const stockData = parseTencentData(text, code);
      if (stockData && stockData.price > 0) {
        return res.json(stockData);
      }
    }
    
    return res.status(404).json({ error: 'Stock not found' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Stock proxy server running at http://localhost:${PORT}`);
  console.log(`Example: http://localhost:${PORT}/stock/600519`);
});
