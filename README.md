# Binance RSI Bot

A trading bot for Binance that uses the Relative Strength Index (RSI) to make trading decisions. This bot not only trades based on RSI but also automatically backtests a range of predefined parameters to find the optimal settings for trading.

## Features

- Monitors RSI values for a specified trading pair.
- Executes buy and sell orders based on RSI thresholds.
- Automatically backtests a range of predefined parameters to determine the best settings.
- Configurable trading settings.
- Real-time logging of trading activities.

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node Package Manager)
- Binance account with API keys

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/throuz/binance-rsi-bot.git
   ```

2. Navigate to the project directory:

   ```bash
   cd binance-rsi-bot
   ```

3. Install the required dependencies:

   ```bash
   npm install
   ```

4. Create a `env-config-real.js` file in the `configs` directory and add your Binance API keys:

   ```javascript
   export const API_KEY = "Your binance api key";
   export const SECRET_KEY = "Your binance secret key";
   export const REST_BASEURL = "Your binance api base url"; // https://fapi.binance.com
   export const LINE_NOTIFY_TOKEN = "Your line notify token";
   ```

## Configuration

1. Open `trade-config.js` in the `configs` directory and configure the settings:

   ```javascript
   export const SYMBOL = "BTCUSDT";
   export const QUOTE_ASSET = "USDT";
   export const ORDER_AMOUNT_PERCENT = 100; // 100%
   export const KLINE_INTERVAL = "1h";
   export const KLINE_LIMIT = 1500;
   export const INITIAL_FUNDING = 100;
   export const FEE = 0.0005; // 0.05%
   export const FUNDING_RATE = 0.0001; // 0.01%
   export const RSI_PERIOD_SETTING = { min: 5, max: 35, step: 1 };
   export const RSI_LONG_LEVEL_SETTING = { min: 65, max: 85, step: 1 };
   export const RSI_SHORT_LEVEL_SETTING = { min: 15, max: 35, step: 1 };
   export const LEVERAGE_SETTING = { min: 3, max: 3, step: 1 };
   export const RANDOM_SAMPLE_NUMBER = null; // number or null
   export const KLINE_START_TIME = getTimestampYearsAgo(4); // timestamp or null
   export const IS_KLINE_START_TIME_TO_NOW = true;
   ```

## Usage

1. Start the bot:

   ```bash
   npm run app:real
   ```

2. The bot will first perform backtesting using the predefined parameter ranges to find the optimal settings.
3. After backtesting, it will use the best parameters to monitor RSI values and execute trades based on the configured thresholds.

## Backtesting

The bot will automatically backtest different parameter combinations within the specified ranges. It evaluates each combination based on historical data to identify the best settings for the trading strategy.

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/your-feature`).
3. Commit your changes (`git commit -am 'Add new feature'`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Create a new Pull Request.

## License

This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/licenses/MIT) file for details.

## Disclaimer

This bot is for educational purposes only. Use it at your own risk. Make sure to test thoroughly before using it with real funds. The author is not responsible for any financial losses incurred from using this bot.
