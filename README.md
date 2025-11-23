# Binance Futures Strategy Optimizer

A comprehensive backtesting and parameter optimization tool for Binance futures trading strategies using Relative Strength Index (RSI) and Moving Average (MA) indicators. This tool automatically tests multiple parameter combinations across predefined ranges to identify optimal trading strategy configurations.

## Features

- **RSI Indicator Analysis** - Uses Relative Strength Index to determine buy/sell timing
- **Moving Average Analysis** - Combines Moving Average for trend analysis
- **Automatic Parameter Optimization** - Automatically tests multiple parameter combinations to find optimal settings
- **Comprehensive Backtest Reports** - Provides detailed trading statistics, P&L analysis, and trade history
- **High-Performance Caching** - Uses caching to optimize calculation performance
- **Binance Futures API Integration** - Supports Binance futures market data retrieval

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node Package Manager)
- Internet connection to access Binance API

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/throuz/binance-rsi-bot.git
   ```

2. Navigate to the project directory:

   ```bash
   cd binance-rsi-bot
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

## Configuration

All configuration is in the `CONFIG` object at the top of the `backtest.js` file. You can adjust the following parameters according to your needs:

### Basic Trading Settings

```javascript
SYMBOL: "BTCUSDT",                    // Trading pair
ORDER_AMOUNT_PERCENT: 100,            // Order amount percentage (100%)
KLINE_INTERVAL: "1h",                 // Kline interval
KLINE_LIMIT: 1500,                    // Number of kline data points
INITIAL_FUNDING: 100,                 // Initial funding
FEE: 0.0005,                          // Trading fee (0.05%)
FUNDING_RATE: 0.0001,                 // Funding rate (0.01%)
```

### Parameter Testing Ranges

```javascript
RSI_PERIOD_SETTING: { min: 1, max: 100, step: 1 },      // RSI period
RSI_LONG_LEVEL_SETTING: { min: 51, max: 100, step: 1 }, // RSI long threshold
RSI_SHORT_LEVEL_SETTING: { min: 1, max: 50, step: 1 },  // RSI short threshold
MA_PERIOD_SETTING: { min: 1, max: 200, step: 1 },       // MA period
LEVERAGE_SETTING: { min: 1, max: 1, step: 1 },          // Leverage
```

### Backtest Settings

```javascript
RANDOM_SAMPLE_NUMBER: 100000,         // Random sample number (null = test all combinations)
KLINE_START_TIME: getTimestampYearsAgo(10), // Backtest start time
IS_KLINE_START_TIME_TO_NOW: true,     // Whether to backtest until now
```

## Usage

Run backtest:

```bash
npm run backtest
```

The backtest process will display:
- Progress bar showing current test progress
- Statistics for the best parameter combination
- Trade history records
- Profit and loss analysis report

## Backtest Report

After the backtest completes, the tool will display the following information:

### Best Parameter Combination
- RSI period, long/short thresholds, MA period, leverage

### Trading Statistics
- Total trades, profitable trades, losing trades
- Win rate, average P&L, total P&L
- Maximum profit, maximum loss

### Fund Changes
- Initial funding, final funding, total return rate

### Trade History
- Detailed records of each trade, including open price, close price, holding time, P&L, etc.

## Project Structure

```
binance-rsi-bot/
├── backtest.js          # Main backtest script (contains all functionality)
├── package.json         # Project configuration
├── package-lock.json    # Dependency lock file
└── README.md           # Project documentation
```

## Technical Details

- **Single-file Architecture** - All functionality integrated in a single file for easy deployment and maintenance
- **Caching Mechanism** - Uses memory caching to optimize RSI and MA calculation performance
- **Async Processing** - Uses async/await for API requests
- **Progress Display** - Uses cli-progress to show backtest progress

## Important Notes

**Risk Warning**

- This tool is for educational and research purposes only
- Backtest results do not guarantee future performance
- Please thoroughly test and verify strategies before trading with real funds
- The author is not responsible for any financial losses

## Contributing

We welcome Issues and Pull Requests!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Create a Pull Request

## License

This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/licenses/MIT) file for details.

## Disclaimer

This tool is for educational purposes only. Use it at your own risk. Make sure to test thoroughly before using it with real funds. The author is not responsible for any financial losses incurred from using this tool.
