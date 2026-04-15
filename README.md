# StockSentinel 股票哨兵 - Electron 桌面应用

## 安装和运行

### 1. 安装依赖

```bash
cd /Users/dev006/.minimax-agent-cn/projects/2/stock-sentinel
npm install
```

### 2. 启动开发模式

需要先启动代理服务器，然后启动 Electron：

```bash
# 终端 1 - 启动代理服务器
node server.js

# 终端 2 - 启动 Electron 应用
npm run start
```

### 3. 构建 macOS 应用

```bash
npm run build:electron
```

构建完成后，应用将生成在 `release` 目录中。

## 功能说明

- **极速涨跌提醒**：当股票价格在 1 分钟内涨跌超过设定阈值时，发送 macOS 系统通知
- **5 分钟定时记录**：每 5 分钟自动记录当前价格到日志
- **系统托盘**：最小化到菜单栏，后台持续监控
- **原生通知**：使用 Electron Notification API，不受浏览器限制

## 支持的 A 股代码

- `600519` - 贵州茅台
- `000001` - 平安银行
- `600036` - 招商银行
- `601318` - 中国平安
- `300750` - 宁德时代
