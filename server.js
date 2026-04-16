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
  '601099': '太平洋',
  '601991': '大唐发电',
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

// ============================================
// 股票技术分析引擎
// ============================================

// 计算简单移动平均 (SMA)
function sma(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / period);
  }
  return result;
}

// 计算指数移动平均 (EMA)
function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// 计算真实波幅 (True Range)
function trueRange(highs, lows, closes, i) {
  const h = highs[i], l = lows[i];
  const prevClose = i > 0 ? closes[i - 1] : closes[i];
  return Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
}

// 计算平均真实波幅 (ATR)
function atr(highs, lows, closes, period = 14) {
  const trs = [];
  for (let i = 0; i < highs.length; i++) {
    trs.push(trueRange(highs, lows, closes, i));
  }
  return sma(trs, period);
}

// 计算相对强弱指数 (RSI)
function rsi(closes, period = 14) {
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));

  const avgGains = [];
  const avgLosses = [];
  let ag = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  avgGains.push(ag);
  avgLosses.push(al);

  for (let i = period; i < changes.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    avgGains.push(ag);
    avgLosses.push(al);
  }

  return avgGains.map((ag, i) => {
    if (avgLosses[i] === 0) return 100;
    const rs = ag / avgLosses[i];
    return 100 - (100 / (1 + rs));
  });
}

// 计算 MACD (12, 26, 9)
function macd(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = ema(dif, 9);
  const bar = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, bar };
}

// 计算布林带
function bollingerBands(closes, period = 20, mult = 2) {
  const smaVals = sma(closes, period);
  const bands = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = smaVals[i - period + 1];
    const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    bands.push({
      upper: mean + mult * std,
      middle: mean,
      lower: mean - mult * std
    });
  }
  return bands;
}

// 计算线性回归斜率（判断趋势方向）
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  // 归一化斜率（相对于均值）
  const mean = sumY / n;
  return mean !== 0 ? (slope / mean) * 100 : 0;
}

// 计算各维度分项得分
function calcScores(history) {
  const closes = history.map(h => h.close);
  const highs = history.map(h => h.high);
  const lows = history.map(h => h.low);
  const volumes = history.map(h => h.volume);

  const n = closes.length;
  if (n < 20) return null; // 数据不足

  // ---------- 1. 趋势分 (30%) ----------
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, Math.min(60, n));

  const i = n - 1;
  let trendScore = 0;
  if (ma5[i] > ma10[i]) trendScore += 25;
  if (ma10[i] > ma20[i]) trendScore += 25;
  if (ma20[i] > ma60[i]) trendScore += 25;
  if (closes[i] > ma5[i]) trendScore += 25;

  // 额外：均线斜率方向
  const slope5 = linearSlope(ma5.slice(-10));
  const slope20 = linearSlope(ma20.slice(-20));
  if (slope5 > 0) trendScore = Math.min(100, trendScore + 5);
  if (slope20 > 0) trendScore = Math.min(100, trendScore + 5);

  // ---------- 2. 动量分 (25%) ----------
  let momentumScore = 0;

  // RSI
  const rsiVals = rsi(closes, 14);
  const curRsi = rsiVals[rsiVals.length - 1];
  if (curRsi < 30) momentumScore += 50;       // 超卖
  else if (curRsi < 40) momentumScore += 35;
  else if (curRsi < 50) momentumScore += 25;
  else if (curRsi < 60) momentumScore += 35;
  else if (curRsi < 70) momentumScore += 40;
  else momentumScore += 25;                     // 超买

  // MACD
  const { dif, dea, bar } = macd(closes);
  const curBar = bar[bar.length - 1];
  const prevBar = bar[bar.length - 2];
  if (dif[dif.length - 1] > dea[dea.length - 1]) momentumScore += 15;
  if (dif[dif.length - 1] > 0) momentumScore += 10;
  if (curBar > 0 && curBar > prevBar) momentumScore += 15; // 红柱放大
  else if (curBar < 0 && curBar < prevBar) momentumScore += 10; // 绿柱缩

  // 近期涨幅
  const gain5 = n >= 6 ? ((closes[n - 1] - closes[n - 6]) / closes[n - 6]) * 100 : 0;
  if (gain5 > 5 && gain5 < 20) momentumScore += 10;
  else if (gain5 >= 0 && gain5 <= 5) momentumScore += 5;

  // ---------- 3. 波动分 (20%) ----------
  let volatilityScore = 0;
  const atrVals = atr(highs, lows, closes, 14);
  const curAtr = atrVals[atrVals.length - 1];
  const atrPct = (curAtr / closes[n - 1]) * 100;

  if (atrPct < 1.5) volatilityScore += 40;     // 低波动稳定
  else if (atrPct < 2.5) volatilityScore += 30;
  else if (atrPct < 4) volatilityScore += 20;

  // 布林带
  const bb = bollingerBands(closes, 20, 2);
  const curBB = bb[bb.length - 1];
  const bbWidth = (curBB.upper - curBB.lower) / curBB.middle;
  const prevBBWidth = (bb[bb.length - 2].upper - bb[bb.length - 2].lower) / bb[bb.length - 2].middle;
  if (bbWidth < prevBBWidth * 0.95) volatilityScore += 30; // 布林带收口
  else if (bbWidth > prevBBWidth) volatilityScore += 10;

  // 价格在布林带中的位置
  const bbPos = (closes[n - 1] - curBB.lower) / (curBB.upper - curBB.lower);
  if (bbPos > 0.2 && bbPos < 0.8) volatilityScore += 20;
  else if (bbPos >= 0.4 && bbPos <= 0.6) volatilityScore += 15;

  // ---------- 4. 量能分 (15%) ----------
  let volumeScore = 0;
  const volMa20 = sma(volumes, 20);
  const curVolMa20 = volMa20[volMa20.length - 1];
  const todayVol = volumes[n - 1];
  const volRatio = todayVol / curVolMa20;

  if (volRatio > 1.5) volumeScore += 40;
  else if (volRatio > 1.2) volumeScore += 30;
  else if (volRatio > 0.8) volumeScore += 20;

  // 量价配合：上涨放量/下跌缩量
  const priceUp = closes[n - 1] > closes[n - 2];
  if (priceUp && volRatio > 1.0) volumeScore += 20; // 上涨放量
  else if (!priceUp && volRatio < 1.0) volumeScore += 15; // 下跌缩量
  else if (priceUp && volRatio < 0.8) volumeScore += 5;   // 价涨量缩
  else volumeScore += 10;

  // ---------- 5. 价格位置分 (10%) ----------
  let positionScore = 0;
  const periodHigh = Math.max(...closes.slice(-60));
  const periodLow = Math.min(...closes.slice(-60));
  const pricePos = (closes[n - 1] - periodLow) / (periodHigh - periodLow || 1);

  if (pricePos < 0.3) positionScore += 50;      // 低位买入区间
  else if (pricePos < 0.5) positionScore += 40;
  else if (pricePos < 0.7) positionScore += 30;
  else if (pricePos < 0.85) positionScore += 20;
  else positionScore += 10;                     // 接近高位

  // ---------- 综合得分 ----------
  const total =
    trendScore * 0.30 +
    momentumScore * 0.25 +
    volatilityScore * 0.20 +
    volumeScore * 0.15 +
    positionScore * 0.10;

  return {
    trend: Math.round(trendScore),
    momentum: Math.round(momentumScore),
    volatility: Math.round(volatilityScore),
    volume: Math.round(volumeScore),
    position: Math.round(positionScore),
    total: Math.round(total),
    details: {
      ma5: Math.round(ma5[ma5.length - 1] * 100) / 100,
      ma10: Math.round(ma10[ma10.length - 1] * 100) / 100,
      ma20: Math.round(ma20[ma20.length - 1] * 100) / 100,
      ma60: ma60.length > 0 ? Math.round(ma60[ma60.length - 1] * 100) / 100 : null,
      rsi: Math.round(curRsi * 10) / 10,
      macd: {
        dif: Math.round(dif[dif.length - 1] * 100) / 100,
        dea: Math.round(dea[dea.length - 1] * 100) / 100,
        bar: curBar > 0 ? '红' : '绿'
      },
      bb: {
        upper: Math.round(curBB.upper * 100) / 100,
        middle: Math.round(curBB.middle * 100) / 100,
        lower: Math.round(curBB.lower * 100) / 100,
        width: Math.round(bbWidth * 10000) / 100
      },
      atr: Math.round(curAtr * 100) / 100,
      atrPct: Math.round(atrPct * 100) / 100,
      volRatio: Math.round(volRatio * 100) / 100,
      pricePos: Math.round(pricePos * 100) / 100,
      gain5: Math.round(gain5 * 100) / 100,
      slope5: Math.round(slope5 * 1000) / 1000
    }
  };
}

// 评分等级描述
function getScoreLevel(total) {
  if (total >= 80) return { label: '强烈买入', color: '#00c853', desc: '技术面非常强势' };
  if (total >= 65) return { label: '建议买入', color: '#43a047', desc: '多个指标向好' };
  if (total >= 50) return { label: '谨慎持有', color: '#fb8c00', desc: '方向不明' };
  if (total >= 35) return { label: '建议观望', color: '#e53935', desc: '偏弱' };
  return { label: '建议回避', color: '#c62828', desc: '技术面弱势' };
}

// 股票分析接口
app.get('/analyze/:code', async (req, res) => {
  const { code } = req.params;
  const days = parseInt(req.query.days) || 500;
  const formattedCode = formatStockCode(code);

  try {
    // 并行获取实时数据 + 历史K线
    const [quoteRes, histRes] = await Promise.all([
      fetch(`http://qt.gtimg.cn/q=${formattedCode}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      }),
      fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayhfq&param=${formattedCode},day,,,${days},qfq`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      })
    ]);

    const histText = await histRes.text();
    const histJson = JSON.parse(histText.replace('kline_dayhfq=', ''));
    const histKey = Object.keys(histJson.data || {})[0];
    if (!histKey || !histJson.data[histKey]?.qfqday) {
      return res.status(404).json({ error: '无历史数据' });
    }

    const raw = histJson.data[histKey].qfqday;
    const history = raw.map(item => ({
      date: item[0],
      open: parseFloat(item[1]),
      close: parseFloat(item[2]),
      high: parseFloat(item[3]),
      low: parseFloat(item[4]),
      volume: parseFloat(item[5])
    }));

    const quoteText = await quoteRes.text();
    const stockData = parseTencentData(quoteText, code);
    const score = calcScores(history);
    if (!score) {
      return res.status(400).json({ error: '历史数据不足' });
    }

    const level = getScoreLevel(score.total);

    return res.json({
      code,
      name: A_STOCK_NAMES[code] || stockData?.name || code,
      currentPrice: stockData?.price || history[history.length - 1].close,
      changePercent: stockData?.changePercent || 0,
      score,
      level,
      history: history.slice(-10) // 最近10天K线
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 获取股票历史K线数据（支持轻量图表格式）
app.get('/history/:code', async (req, res) => {
  const { code } = req.params;
  const days = parseInt(req.query.days) || 500;
  const chartFormat = req.query.chart === 'true';
  const formattedCode = formatStockCode(code);

  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayhfq&param=${formattedCode},day,,,${days},qfq`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });

    if (!response.ok) return res.status(500).json({ error: 'Failed to fetch data' });

    const text = await response.text();
    const jsonStr = text.replace('kline_dayhfq=', '');
    const data = JSON.parse(jsonStr);

    const key = Object.keys(data.data || {})[0];
    if (!key || !data.data[key]?.qfqday) {
      return res.status(404).json({ error: 'No history data' });
    }

    const raw = data.data[key].qfqday;
    // 每条: [日期, 开, 收, 高, 低, 成交量]
    const history = raw.map(item => {
      const open = parseFloat(item[1]);
      const close = parseFloat(item[2]);
      const high = parseFloat(item[3]);
      const low = parseFloat(item[4]);
      const volume = parseFloat(item[5]);
      const prevClose = raw.indexOf(item) > 0 ? parseFloat(raw[raw.indexOf(item) - 1][2]) : open;
      const change = close - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const dateStr = item[0];
      // 转换日期为时间戳（秒）
      const [y, m, d] = dateStr.split('-').map(Number);
      const time = Math.floor(new Date(y, m - 1, d).getTime() / 1000);

      return {
        date: dateStr,
        time,
        open,
        close,
        high,
        low,
        volume,
        change,
        changePercent
      };
    });

    // 轻量图表格式（主K线 + 成交量柱）
    if (chartFormat) {
      const candles = history.map(h => ({
        time: h.time,
        open: h.open,
        high: h.high,
        low: h.low,
        close: h.close
      }));
      const volumes = history.map(h => ({
        time: h.time,
        value: h.volume,
        color: h.changePercent >= 0 ? '#FF453A' : '#32D74B'
      }));
      // 计算均线
      const closes = history.map(h => h.close);
      const ma5 = calcSMA(closes, 5, history.map(h => h.time));
      const ma10 = calcSMA(closes, 10, history.map(h => h.time));
      const ma20 = calcSMA(closes, 20, history.map(h => h.time));

      return res.json({ code, candles, volumes, ma5, ma10, ma20 });
    }

    return res.json({ code, history });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// 计算简单均线（返回轻量图表格式）
function calcSMA(closes, period, times) {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    result.push({ time: times[i], value: slice.reduce((s, v) => s + v, 0) / period });
  }
  return result;
}

app.listen(PORT, () => {
  console.log(`Stock proxy server running at http://localhost:${PORT}`);
  console.log(`股票查询: http://localhost:${PORT}/stock/600519`);
  console.log(`历史K线:  http://localhost:${PORT}/history/600519?days=30`);
  console.log(`技术分析: http://localhost:${PORT}/analyze/600519`);
});
