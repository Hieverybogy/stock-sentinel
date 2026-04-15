import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global references
let mainWindow = null;
let tray = null;
const isDev = !app.isPackaged;
const API_PORT = 7099;
const API_TARGET = 'http://47.113.228.135:7099';

// 本地代理服务
let proxyServer = null;

function startProxyServer() {
  var proxyApp = express();
  proxyApp.use(cors());
  proxyApp.use(bodyParser.json());
  proxyApp.use(bodyParser.urlencoded({ extended: true }));

  // A股股票名称映射
  const A_STOCK_NAMES = {
    '600519': '贵州茅台', '600036': '招商银行', '000001': '平安银行',
    '601318': '中国平安', '600900': '长江电力', '000858': '五粮液',
    '600276': '恒瑞医药', '300750': '宁德时代', '601398': '工商银行',
    '601988': '中国银行', '601939': '建设银行', '601288': '农业银行',
    '600030': '中信证券', '600016': '民生银行', '600000': '浦发银行',
    '601166': '兴业银行',
  };

  // 格式化股票代码
  function formatStockCode(code) {
    const numCode = code.replace(/[^0-9]/g, '');
    if (numCode.startsWith('6')) return `sh${numCode}`;
    if (numCode.startsWith('0') || numCode.startsWith('3')) return `sz${numCode}`;
    return code;
  }

  // 解析腾讯财经数据
  function parseTencentData(dataStr, code) {
    try {
      const match = dataStr.match(/v_(\w+)=["'](.+?)["']/);
      if (!match) return null;
      const fields = match[2].split('~');
      return {
        code: (fields[2] || code).replace('sh', '').replace('sz', ''),
        name: fields[1] || A_STOCK_NAMES[code] || code,
        price: parseFloat(fields[3]) || 0,
        change: parseFloat(fields[30]) || 0,
        changePercent: parseFloat(fields[31]) || 0,
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      return null;
    }
  }

  // 股票查询接口
  proxyApp.get('/stock/:code', async (req, res) => {
    const { code } = req.params;
    const formattedCode = formatStockCode(code);
    try {
      const response = await fetch(`http://qt.gtimg.cn/q=${formattedCode}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      if (!response.ok) return res.status(500).json({ error: 'Failed to fetch data' });
      const text = await response.text();
      if (text && text.includes('=')) {
        const stockData = parseTencentData(text, code);
        if (stockData && stockData.price > 0) return res.json(stockData);
      }
      return res.status(404).json({ error: 'Stock not found' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  // 代理所有 /api 开头的请求到目标服务器
  proxyApp.use('/api', async (req, res) => {
    const targetPath = req.originalUrl.replace(/^\/api/, '');
    try {
      const targetUrl = `${API_TARGET}${targetPath}`;
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: { ...req.headers, host: new URL(API_TARGET).host },
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
      });
      const data = await response.text();
      res.status(response.status).set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }).send(data);
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });

  proxyServer = proxyApp.listen(API_PORT, '127.0.0.1', () => {
    console.log(`[Proxy] Local API server running at http://localhost:${API_PORT}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Proxy] Port ${API_PORT} already in use, skipping internal server.`);
    } else {
      console.error('[Proxy] Server error:', err);
    }
  });
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 600,
    title: 'StockSentinel 股票哨兵',
    backgroundColor: '#1C1C1E',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('Window created');
}

// Create system tray
function createTray() {
  // Create a simple 16x16 tray icon
  // extraResources 会把文件放到 resources/ 目录
  const resourcePath = app.isPackaged 
    ? process.resourcesPath 
    : path.join(__dirname, '../public');
  
  const iconPath = path.join(resourcePath, 'tray-icon.png');
  
  // Create a default icon if not exists
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Create a simple colored icon
      trayIcon = nativeImage.createEmpty();
    }
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADXSURBVDiNpZMxDoJAEEXfLhYewMrCyt7KxsLSA3gCO2s9gR09gZ6ADt4AC0sLC0sLC0sLC0tIYuHYMhv/wMDOMJkZAOq6Lk3T0HVNxphqGUJIKUVKKZVSYk3JK6+qiq7riOOH7wHwBQKBn78HAAiCIEiS5Ad4f39/Z1l2DYAQQuM4juM4/gJAAADgF/gCaLvJZR9z6W4AAAAASUVORK5CYII=') : trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('StockSentinel 股票哨兵');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  console.log('Tray created');
}

// IPC handler for notifications
ipcMain.handle('show-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      silent: false
    });
    notification.show();
    return true;
  }
  return false;
});

// App ready
app.whenReady().then(() => {
  console.log('App ready, creating window...');
  // 启动本地代理服务
  // startProxyServer();
  createWindow();
  createTray();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

// 退出时关闭代理服务
app.on('before-quit', () => {
  app.isQuitting = true;
  if (proxyServer) {
    proxyServer.close();
  }
});
