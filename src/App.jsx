import { useState, useEffect, useRef, useCallback } from 'react'
import { createChart, CrosshairMode, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'

// A股股票名称映射
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
}

// 检测是否在 Electron 环境中
// const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron
const isElectron =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toLowerCase().includes('electron')
  
// 根据运行环境设置 API 地址
// 开发模式: 使用 Vite proxy (相对路径 /api)
// Electron 打包模式: 使用 Electron 主进程中的代理服务 (http://localhost:7099)
const getProxyUrl = () => {
  // 如果是 Electron 环境，指向本地代理服务器
  if (isElectron) {
    return 'http://47.113.228.135:7099'
  }
  // 开发模式使用相对路径，由 Vite proxy 处理
  return '/api'
}

// 格式化价格 (A股用人民币)
function formatPrice(price) {
  return `¥${parseFloat(price).toFixed(2)}`
}

// 格式化涨跌幅金额
function formatPercentPrice(percent) {
  const sign = percent >= 0 ? '+' : ''
  return `${sign}${parseFloat(percent).toFixed(2)}`
}

// 格式化涨跌幅
function formatPercent(percent) {
  const sign = percent >= 0 ? '+' : ''
  return `${sign}${parseFloat(percent).toFixed(2)}%`
}

// 获取当前时间字符串
function getTimeString() {
  return new Date().toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  })
}

// 获取 HH:MM 用于日志
function getLogTime() {
  return new Date().toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit'
  })
}

const getUpDownClass = (percent) => {
  return parseFloat(percent) >= 0 ? 'up' : 'down'
}

// 评分条组件
function ScoreBar({ label, value, desc, tip, onTip }) {
  const color = value >= 70 ? '#00c853'
    : value >= 50 ? '#43a047'
    : value >= 35 ? '#fb8c00'
    : '#e53935'
  return (
    <div
      className="score-bar-item"
      onMouseEnter={(e) => tip && onTip({ visible: true, x: e.clientX, y: e.clientY, content: tip })}
      onMouseMove={(e) => tip && onTip(prev => ({ ...prev, x: e.clientX, y: e.clientY }))}
      onMouseLeave={() => tip && onTip(prev => ({ ...prev, visible: false }))}
    >
      <div className="score-bar-header">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-value" style={{ color }}>{value}</span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <div className="score-bar-desc">{desc}</div>
    </div>
  )
}

// 指标单元格（带tooltip）
function IndicatorCell({ label, value, tip, onTip }) {
  return (
    <span
      className="indicator-item"
      onMouseEnter={(e) => tip && onTip({ visible: true, x: e.clientX, y: e.clientY, content: tip })}
      onMouseMove={(e) => tip && onTip(prev => ({ ...prev, x: e.clientX, y: e.clientY }))}
      onMouseLeave={() => tip && onTip(prev => ({ ...prev, visible: false }))}
    >
      {label} <strong>{value}</strong>
    </span>
  )
}

// 本地代理服务器地址
const PROXY_URL = '/api'

function App() {
  const [stockCode, setStockCode] = useState('')
  const [currentStock, setCurrentStock] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [logs, setLogs] = useState([])
  const [threshold, setThreshold] = useState({ rise: 2, fall: 2 })
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [nextUpdate, setNextUpdate] = useState(5)
  const [flashClass, setFlashClass] = useState('')
  const [notificationPermission, setNotificationPermission] = useState('granted')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isElectronApp, setIsElectronApp] = useState(false)
  const [analyzeData, setAnalyzeData] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [chartData, setChartData] = useState(null)
  const chartContainerRef = useRef(null)
  const chartInstanceRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, content: '' })
  
  const rapidCheckRef = useRef(null)
  const fiveMinCheckRef = useRef(null)
  const countdownRef = useRef(null)
  const lastAlertRef = useRef({})

  // 检测运行环境
  useEffect(() => {
    setIsElectronApp(isElectron || false)
    // Electron 不需要浏览器通知权限
    if (isElectron) {
      setNotificationPermission('granted')
    } else if (typeof Notification !== 'undefined') {
      setNotificationPermission(Notification.permission)
    }
  }, [])

  // 发送桌面通知 - 支持 Electron 原生通知
  const sendNotification = async (title, body) => {
    if (isElectronApp && window.electronAPI) {
      // 使用 Electron 原生通知
      try {
        await window.electronAPI.showNotification(title, body)
      } catch (e) {
        console.error('Electron notification error:', e)
      }
    } else if (notificationPermission === 'granted') {
      // 使用浏览器通知
      new Notification(title, {
        body,
        silent: false
      })
    }
  }

  // 从本地代理获取股票数据
  const fetchStockData = useCallback(async () => {
    if (!stockCode.trim()) return

    const code = stockCode.trim()
    
    try {
      setLoading(true)
      const proxyUrl = getProxyUrl()
      const url = `${proxyUrl}/stock/${code}`
      
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`)
      }

      const stockData = await response.json()
      
      if (stockData && stockData.price > 0) {
        const name = A_STOCK_NAMES[code] || stockData.name || code
        stockData.name = name
        stockData.increase = formatPercent(
          stockData.changePercent / (stockData.price - stockData.changePercent) * 100
        )
        setCurrentStock(stockData)
        setLastUpdate(new Date())
        setConnected(true)
        setError(null)

        // 更新菜单栏图标旁显示
        if (isElectronApp && window.electronAPI) {
          window.electronAPI.updateDock(stockData).catch(() => {})
        }

        // 加载K线图表和技术分析数据
        fetchChartData()
        fetchAnalyzeData()

        const newHistory = [...priceHistory, { 
          price: stockData.price, 
          timestamp: new Date() 
        }].slice(-60)
        
        setPriceHistory(newHistory)

        if (newHistory.length >= 6) {
          const oldPrice = newHistory[newHistory.length - 6].price
          const changePercent1Min = ((stockData.price - oldPrice) / oldPrice) * 100
         
          const now = Date.now()
          const lastAlert = lastAlertRef.current[code] || 0
            
          if (changePercent1Min >= threshold.rise && (now - lastAlert > 60000)) {
            const logEntry = {
              time: getLogTime(),
              price: stockData.price,
              changePercent: stockData.changePercent,
              isAlert: true,
              alertType: 'rise',
              fullTime: getTimeString(),
              changePercent1Min
            }
            setLogs(prev => [logEntry, ...prev].slice(0, 100))
            sendNotification(
              '🚀 极速上涨提醒',
              `${stockData.name || code} 1分钟内上涨 ${changePercent1Min.toFixed(2)}%`
            )
            setFlashClass('flash-up')
            setTimeout(() => setFlashClass(''), 500)
            lastAlertRef.current[code] = now
          } else if (changePercent1Min <= -threshold.fall && (now - lastAlert > 60000)) {
            const logEntry = {
              time: getLogTime(),
              price: stockData.price,
              changePercent: stockData.changePercent,
              isAlert: true,
              alertType: 'fall',
              fullTime: getTimeString(),
              changePercent1Min
            }
            setLogs(prev => [logEntry, ...prev].slice(0, 100))
            sendNotification(
              '⚠️ 极速下跌提醒',
              `${stockData.name || code} 1分钟内下跌 ${Math.abs(changePercent1Min).toFixed(2)}%`
            )
            setFlashClass('flash-down')
            setTimeout(() => setFlashClass(''), 500)
            lastAlertRef.current[code] = now
          }
        }
      } else {
        setError('获取数据失败，请检查股票代码')
        setConnected(false)
      }
    } catch (err) {
      console.error('Fetch error:', err)
      setError('请先启动本地代理服务器: ' + getProxyUrl())
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [stockCode, priceHistory, threshold, isElectronApp])

  // 获取股票技术分析
  const fetchAnalyzeData = useCallback(async () => {
    if (!stockCode.trim()) return
    try {
      setAnalyzing(true)
      const proxyUrl = getProxyUrl()
      const response = await fetch(`${proxyUrl}/analyze/${stockCode.trim()}?days=120`)
      if (response.ok) {
        const data = await response.json()
        setAnalyzeData(data)
      }
    } catch (err) {
      console.error('Analyze error:', err)
    } finally {
      setAnalyzing(false)
    }
  }, [stockCode])

  // 获取K线图表数据
  const fetchChartData = useCallback(async () => {
    if (!stockCode.trim()) return
    try {
      const proxyUrl = getProxyUrl()
      const response = await fetch(`${proxyUrl}/history/${stockCode.trim()}?chart=true&days=500`)
      if (response.ok) {
        const data = await response.json()
        setChartData(data)
      }
    } catch (err) {
      console.error('Chart data error:', err)
    }
  }, [stockCode])

  // 提交股票代码
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!stockCode.trim()) return

    setLogs([])
    setPriceHistory([])
    setError(null)
    setAnalyzeData(null)
    setChartData(null)
    lastAlertRef.current = {}
    fetchStockData()
    fetchAnalyzeData()
    fetchChartData()
  }

  useEffect(() => {
    if (!stockCode.trim()) return

    rapidCheckRef.current = setInterval(() => {
      fetchStockData()
    }, 10000)

    return () => {
      if (rapidCheckRef.current) {
        clearInterval(rapidCheckRef.current)
      }
    }
  }, [stockCode, fetchStockData])

  // 5分钟定时记录
  useEffect(() => {
    if (!stockCode.trim() || !currentStock) return

    fiveMinCheckRef.current = setInterval(() => {
      const logEntry = {
        time: getLogTime(),
        price: currentStock.price,
        changePercent: currentStock.changePercent,
        isAlert: false,
        fullTime: getTimeString()
      }
      setLogs(prev => [logEntry, ...prev].slice(0, 100))
    }, 300000)

    return () => {
      if (fiveMinCheckRef.current) {
        clearInterval(fiveMinCheckRef.current)
      }
    }
  }, [stockCode, currentStock])

  // 初始化K线图表
  useEffect(() => {
    if (!chartContainerRef.current || !chartData) return

    // 清理旧图表
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove()
      chartInstanceRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }

    const container = chartContainerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { color: '#2C2C2E' },
        textColor: '#98989D',
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(255,255,255,0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(255,255,255,0.3)', width: 1, style: 2 }
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)'
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 10
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true }
    })

    chartInstanceRef.current = chart

    // 主K线 (v5 API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#FF453A',
      downColor: '#32D74B',
      borderUpColor: '#FF453A',
      borderDownColor: '#32D74B',
      wickUpColor: '#FF453A',
      wickDownColor: '#32D74B'
    })
    candleSeries.setData(chartData.candles)
    candleSeriesRef.current = candleSeries

    // 成交量柱 (v5 API)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume'
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    })
    volumeSeries.setData(chartData.volumes)
    volumeSeriesRef.current = volumeSeries

    // 均线 (v5 API)
    if (chartData.ma5.length > 0) {
      chart.addSeries(LineSeries, { color: '#FFD60A', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.ma5)
    }
    if (chartData.ma10.length > 0) {
      chart.addSeries(LineSeries, { color: '#0A84FF', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.ma10)
    }
    if (chartData.ma20.length > 0) {
      chart.addSeries(LineSeries, { color: '#bf5af2', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(chartData.ma20)
    }

    // 默认显示近两个月，其余可拖动缩放查看
    const lastCandle = chartData.candles[chartData.candles.length - 1]
    if (lastCandle && lastCandle.time) {
      chart.timeScale().setVisibleRange({
        from: lastCandle.time - 126 * 86400,
        to: lastCandle.time + 5 * 86400
      })
    } else {
      chart.timeScale().fitContent()
    }

    // 响应窗口宽度
    const resizeObserver = new ResizeObserver(() => {
      if (chartInstanceRef.current && chartContainerRef.current) {
        chartInstanceRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove()
        chartInstanceRef.current = null
      }
    }
  }, [chartData])
  useEffect(() => {
    if (!stockCode.trim()) return

    let seconds = 300
    countdownRef.current = setInterval(() => {
      seconds--
      setNextUpdate(Math.ceil(seconds / 60))
      if (seconds <= 0) seconds = 300
    }, 1000)

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
      }
    }
  }, [stockCode])


  return (
    <div className="app-container">
      <div className="title-bar">
        <h1>StockSentinel 股票哨兵</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </div>

      <div className="main-content">
        {/* Electron 标识 */}
        {isElectronApp && (
          <div className="electron-badge">
            <span>🖥️</span> 桌面应用模式
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="error-toast">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* 启动说明 - 仅在非 Electron 模式下显示 */}
        {!isElectronApp && (
          <div className="server-hint">
            <p>⚠️ 需要启动本地代理服务器：</p>
            <code>pm2 start ecosystem.config.js</code>
          </div>
        )}

        {/* 股票输入 */}
        <form className="stock-input-section" onSubmit={handleSubmit}>
          <div className="stock-input-wrapper">
            <span className="input-icon">🔍</span>
            <input
              type="text"
              className="stock-input"
              placeholder="输入A股代码 (如 600519, 000001)"
              value={stockCode}
              onChange={(e) => setStockCode(e.target.value)}
            />
          </div>
          <button type="submit" className="search-btn" disabled={loading}>
            {loading ? '加载中...' : '开始监控'}
          </button>
        </form>

        {/* 价格卡片 */}
        {currentStock && (
          <div className={`price-card ${flashClass}`}>
            <div className="price-card-header">
              <div>
                <div className="stock-code">{currentStock.code}</div>
                <div className="stock-name">{currentStock.name}</div>
              </div>
            </div>
            <div className="current-price">
              {formatPrice(currentStock.price)}
            </div>
            <div className={`price-change ${getUpDownClass(currentStock.changePercent)}`}>
              <span className="change-arrow">
                {parseFloat(currentStock.changePercent) >= 0 ? '▲' : '▼'}
              </span>
              {formatPercentPrice(currentStock.changePercent)}
              &nbsp;&nbsp;
              {formatPercent(
                currentStock.changePercent / (currentStock.price - currentStock.changePercent) * 100
              )}
            </div>
            <div className="market-status">
              <span>🔴</span>
              <span>实时数据 · 腾讯财经</span>
            </div>
          </div>
        )}

        {/* 技术分析卡片 */}
        {currentStock && (
          <div className="analyze-card">
            <div className="analyze-header">
              <div className="analyze-title">
                <span>📊</span>
                <h3>技术分析</h3>
                {analyzing && <span className="analyzing-tag">分析中...</span>}
                {!analyzing && analyzeData && (
                  <button className="refresh-analyze-btn" onClick={fetchAnalyzeData}>
                    刷新
                  </button>
                )}
              </div>
              {analyzeData && (
                <div className="analyze-level-badge" style={{ background: analyzeData.level.color }}>
                  {analyzeData.level.label}
                </div>
              )}
            </div>

            {!analyzeData && !analyzing && (
              <div className="analyze-loading">
                <p>正在加载技术分析数据...</p>
              </div>
            )}

            {analyzeData && (
              <>
                {/* 综合评分 */}
                <div className="analyze-total-section">
                  <div className="total-score" style={{ color: analyzeData.level.color }}>
                    {analyzeData.score.total}
                  </div>
                  <div className="total-desc">
                    <div className="total-label">综合评分</div>
                    <div className="total-level" style={{ color: analyzeData.level.color }}>
                      {analyzeData.level.label}
                    </div>
                    <div className="total-sub">{analyzeData.level.desc}</div>
                  </div>
                </div>

                {/* 五维评分条 */}
                <div className="score-bars">
                  <ScoreBar label="趋势" value={analyzeData.score.trend} desc="均线排列"
                    tip={`权重30%｜MA5>MA10>MA20>MA60 各+25分\n均线斜率为正各+5分（短期+中期方向）\n满分100分，当前得分：${analyzeData.score.trend}`}
                    onTip={setTooltip} />
                  <ScoreBar label="动量" value={analyzeData.score.momentum} desc="RSI/MACD"
                    tip={`权重25%｜RSI(14日)超卖<30得50分\nMACD金叉(DIF>DEA)+15，DIF>0+10\n5日涨幅5%~20%得10分\n满分100分，当前得分：${analyzeData.score.momentum}`}
                    onTip={setTooltip} />
                  <ScoreBar label="波动" value={analyzeData.score.volatility} desc="布林带/ATR"
                    tip={`权重20%｜ATR相对波动<1.5%得40分（稳定）\n布林带收口得30分（酝酿突破）\n价格在布林带中间区域得20分\n满分100分，当前得分：${analyzeData.score.volatility}`}
                    onTip={setTooltip} />
                  <ScoreBar label="量能" value={analyzeData.score.volume} desc="量价配合"
                    tip={`权重15%｜量比>1.5得40分（放量）\n上涨放量+20分，下跌缩量+15分\n量价背离（价涨量缩）仅得5分\n满分100分，当前得分：${analyzeData.score.volume}`}
                    onTip={setTooltip} />
                  <ScoreBar label="位置" value={analyzeData.score.position} desc="价格区间"
                    tip={`权重10%｜近60日区间的相对位置\n<30%低位得50分（买入区间）\n>85%高位得10分（风险积累）\n满分100分，当前得分：${analyzeData.score.position}`}
                    onTip={setTooltip} />
                </div>

                {/* 关键指标 */}
                <div className="analyze-indicators">
                  <div className="indicator-group">
                    <div className="indicator-title">均线</div>
                    <div className="indicator-values">
                      <IndicatorCell label="MA5" value={analyzeData.score.details.ma5}
                        tip="5日简单移动平均线，反映短期价格趋势方向"
                        onTip={setTooltip} />
                      <IndicatorCell label="MA10" value={analyzeData.score.details.ma10}
                        tip="10日简单移动平均线，短中期过渡均线"
                        onTip={setTooltip} />
                      <IndicatorCell label="MA20" value={analyzeData.score.details.ma20}
                        tip="20日简单移动平均线，中期重要支撑/压力线"
                        onTip={setTooltip} />
                      {analyzeData.score.details.ma60 && (
                        <IndicatorCell label="MA60" value={analyzeData.score.details.ma60}
                          tip="60日简单移动平均线，中长期趋势判断基准"
                          onTip={setTooltip} />
                      )}
                    </div>
                  </div>
                  <div className="indicator-group">
                    <div className="indicator-title">MACD</div>
                    <div className="indicator-values">
                      <span className={`indicator-item ${analyzeData.score.details.macd.bar === '红' ? 'up' : 'down'}`}>
                        {analyzeData.score.details.macd.bar}柱
                      </span>
                      <IndicatorCell label="DIF" value={analyzeData.score.details.macd.dif}
                        tip="MACD快线（EMA12-EMA26），DIF上穿DEA形成金叉买入信号"
                        onTip={setTooltip} />
                      <IndicatorCell label="DEA" value={analyzeData.score.details.macd.dea}
                        tip="MACD慢线（9日DIF均值），对DIF有支撑/压力作用"
                        onTip={setTooltip} />
                    </div>
                  </div>
                  <div className="indicator-group">
                    <div className="indicator-title">其他指标</div>
                    <div className="indicator-values">
                      <IndicatorCell label="RSI" value={analyzeData.score.details.rsi}
                        tip={`RSI(14日)：衡量涨跌力量对比\n<30超卖（买入机会），>70超买（注意风险）\n当前RSI：${analyzeData.score.details.rsi}`}
                        onTip={setTooltip} />
                      <IndicatorCell label="ATR" value={analyzeData.score.details.atr}
                        tip={`真实波幅均值(14日)，衡量价格波动剧烈程度\nATR百分比：${analyzeData.score.details.atrPct}%\nATR越大波动越剧烈，当前属于${analyzeData.score.details.atrPct < 1.5 ? '低' : analyzeData.score.details.atrPct < 2.5 ? '中' : '高'}波动`}
                        onTip={setTooltip} />
                      <IndicatorCell label="量比" value={`${analyzeData.score.details.volRatio}x`}
                        tip={`当日成交量 / 20日均量\n>1.5倍为明显放量，>2倍为巨量\n当前量比：${analyzeData.score.details.volRatio}x（${analyzeData.score.details.volRatio > 1.5 ? '放量' : analyzeData.score.details.volRatio > 0.8 ? '正常' : '缩量'}）`}
                        onTip={setTooltip} />
                    </div>
                  </div>
                  <div className="indicator-group">
                    <div className="indicator-title">布林带</div>
                    <div className="indicator-values">
                      <span className="indicator-item up">上轨 <strong>{analyzeData.score.details.bb.upper}</strong></span>
                      <span className="indicator-item">中轨 <strong>{analyzeData.score.details.bb.middle}</strong></span>
                      <span className="indicator-item down">下轨 <strong>{analyzeData.score.details.bb.lower}</strong></span>
                      <IndicatorCell label="带宽" value={`${analyzeData.score.details.bb.width}%`}
                        tip={`布林带宽度指标，反映市场波动率变化\n带宽收窄（<历史均值）：酝酿突破行情\n带宽放大：趋势延续或反转信号\n当前带宽：${analyzeData.score.details.bb.width}%`}
                        onTip={setTooltip} />
                    </div>
                  </div>
                </div>

                {/* 完整K线图表 */}
                <div className="chart-container">
                  <div className="chart-header">
                    <span className="chart-title">K线走势</span>
                    <div className="chart-legend">
                      <span className="legend-item ma5">MA5</span>
                      <span className="legend-item ma10">MA10</span>
                      <span className="legend-item ma20">MA20</span>
                    </div>
                    <button className="refresh-chart-btn" onClick={fetchChartData}>刷新</button>
                  </div>
                  {!chartData && !analyzing && (
                    <div className="chart-loading">加载中...</div>
                  )}
                  <div ref={chartContainerRef} className="chart-wrapper" />
                </div>
              </>
            )}
          </div>
        )}

        {/* 空状态 */}
        {!currentStock && !error && (
          <div className="price-card">
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <p>输入A股代码开始监控<br/>如 600519 (茅台), 000001 (平安银行)</p>
            </div>
          </div>
        )}

        {/* 阈值设置 */}
        <div className="threshold-section">
          <div className="threshold-header">
            <span>⚡</span>
            <h3>极速提醒阈值</h3>
          </div>
          <div className="threshold-grid">
            <div className="threshold-item up">
              <label>极速上涨触发 (1分钟内)</label>
              <div className="threshold-input">
                <input
                  type="number"
                  value={threshold.rise}
                  onChange={(e) => setThreshold({ ...threshold, rise: parseFloat(e.target.value) || 0 })}
                  step="0.5"
                  min="0"
                />
                <span>%</span>
              </div>
            </div>
            <div className="threshold-item down">
              <label>极速下跌触发 (1分钟内)</label>
              <div className="threshold-input">
                <input
                  type="number"
                  value={threshold.fall}
                  onChange={(e) => setThreshold({ ...threshold, fall: parseFloat(e.target.value) || 0 })}
                  step="0.5"
                  min="0"
                />
                <span>%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 日志区域 */}
        <div className="log-section">
          <div className="log-header">
            <h3>监控日志</h3>
            <span className="log-count">{logs.length} 条记录</span>
          </div>
          <div className="log-list">
            {logs.length === 0 && currentStock && (
              <div className="empty-state" style={{ padding: '20px' }}>
                <p>等待定时记录...</p>
              </div>
            )}
            {logs.length === 0 && !currentStock && (
              <div className="empty-state" style={{ padding: '20px' }}>
                <p>输入股票代码开始监控</p>
              </div>
            )}
            {logs.map((log, index) => (
              <div 
                key={index} 
                className={`log-item ${log.isAlert ? 'alert' : ''}`}
              >
                <span className="log-time">{log.fullTime || log.time}</span>
                <div className="log-content">
                  <span className="log-price">
                    {formatPrice(log.price)}
                  </span>
                  <span className={`log-change ${getUpDownClass(log.changePercent)}`}>
                    {formatPercentPrice(log.changePercent)}
                    &nbsp;
                    {formatPercent(
                      log.changePercent / (log.price - log.changePercent) * 100
                    )}
                    {/* &nbsp;&nbsp; */}
                    <div style={{'margin-top': '5px', textAlign: 'right'}}>
                    {log.isAlert && (log.alertType === 'rise' ? '🔔 ' : '⚠️ ')}
                    { formatPercent(log.changePercent1Min) }
                    </div>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 指标说明悬浮提示 */}
      {tooltip.visible && (
        <div
          className="indicator-tooltip"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 10,
          }}
        >
          {tooltip.content.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {/* 状态栏 */}
      <div className="status-bar">
        <div className="last-update">
          <span>🕐</span>
          <span>最后更新: {lastUpdate ? getTimeString() : '--:--:--'}</span>
        </div>
        <div className="next-update">
          <span>⏱️</span>
          <span>下次记录: {stockCode ? `${nextUpdate} 分钟` : '--'}</span>
        </div>
      </div>
    </div>
  )
}

export default App
