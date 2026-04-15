import { useState, useEffect, useRef, useCallback } from 'react'

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
        
        setCurrentStock(stockData)
        setLastUpdate(new Date())
        setConnected(true)
        setError(null)

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

  // 提交股票代码
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!stockCode.trim()) return
    
    setLogs([])
    setPriceHistory([])
    setError(null)
    lastAlertRef.current = {}
    fetchStockData()
  }

  // 10秒极速检查
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

  // 倒计时
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
