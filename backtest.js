// ============================================================================
// Binance RSI Bot - Consolidated Single File
// ============================================================================

import { Presets, SingleBar } from "cli-progress";

// ============================================================================
// Configuration
// ============================================================================

function getTimestampYearsAgo(years) {
  const currentDate = new Date();
  const targetYear = currentDate.getFullYear() - years;
  currentDate.setFullYear(targetYear);
  return currentDate.getTime();
}

const CONFIG = {
  SYMBOL: "BTCUSDT",
  ORDER_AMOUNT_PERCENT: 100, // 100%
  KLINE_INTERVAL: "1h",
  KLINE_LIMIT: 1500,
  INITIAL_FUNDING: 100,
  FEE: 0.0005, // 0.05%
  FUNDING_RATE: 0.0001, // 0.01%
  RSI_PERIOD_SETTING: { min: 1, max: 100, step: 1 },
  RSI_LONG_LEVEL_SETTING: { min: 50, max: 100, step: 5 },
  RSI_SHORT_LEVEL_SETTING: { min: 5, max: 50, step: 5 },
  LEVERAGE_SETTING: { min: 1, max: 15, step: 1 },
  RANDOM_SAMPLE_NUMBER: null, // number or null
  KLINE_START_TIME: getTimestampYearsAgo(10), // timestamp or null
  IS_KLINE_START_TIME_TO_NOW: true,
  HOUR_MS: 1000 * 60 * 60,
  FUNDING_PERIOD_MS: 8 * 1000 * 60 * 60 // 8 hours
};

// ============================================================================
// Cache Implementation
// ============================================================================

const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds in milliseconds

const nodeCache = {
  has(key) {
    const item = cache.get(key);
    if (!item) return false;
    // Check if expired
    if (Date.now() > item.expiry) {
      cache.delete(key);
      return false;
    }
    return true;
  },
  get(key) {
    const item = cache.get(key);
    if (!item) return undefined;
    // Check if expired
    if (Date.now() > item.expiry) {
      cache.delete(key);
      return undefined;
    }
    return item.value;
  },
  set(key, value) {
    cache.set(key, {
      value,
      expiry: Date.now() + CACHE_TTL
    });
  }
};

// ============================================================================
// Web Services
// ============================================================================

const BASE_URL = "https://fapi.binance.com";

// Helper function to build query string from params
const buildQueryString = (params) => {
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      queryParams.append(key, String(value));
    }
  }
  return queryParams.toString();
};

// Native fetch-based API client
const binanceFuturesAPI = {
  async get(path, options = {}) {
    const { params = {} } = options;
    const queryString = buildQueryString(params);
    const url = `${BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return { data };
  }
};

// ============================================================================
// API Functions
// ============================================================================

const retry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

const getBinanceFuturesAPI = async (path, params = {}) => {
  // Create cache key from path and params
  const paramsString = JSON.stringify(params);
  const key = path + "/" + paramsString;
  if (nodeCache.has(key)) {
    return nodeCache.get(key);
  }

  const fetchData = async () => {
    const response = await binanceFuturesAPI.get(path, { params });
    nodeCache.set(key, response.data);
    return response.data;
  };

  return await retry(fetchData);
};

// GET

const exchangeInformationAPI = async () => {
  const responseData = await getBinanceFuturesAPI("/fapi/v1/exchangeInfo", {});
  return responseData;
};

const klineDataAPI = async (params) => {
  const responseData = await getBinanceFuturesAPI("/fapi/v1/klines", params);
  return responseData;
};

// ============================================================================
// Cached Data Functions
// ============================================================================

/** ---------- Kline Data Functions ---------- */
const getOriginalKlineData = async () => {
  const now = Date.now();
  const originalKlineData = [];
  let startTime = CONFIG.KLINE_START_TIME;
  do {
    const params = {
      symbol: CONFIG.SYMBOL,
      interval: CONFIG.KLINE_INTERVAL,
      limit: CONFIG.KLINE_LIMIT,
      startTime
    };
    const klineData = await klineDataAPI(params);
    // Use push with spread for better performance than concat
    originalKlineData.push(...klineData);
    if (klineData.length > 0) {
      startTime = klineData[klineData.length - 1][6] + 1;
    }
    if (!CONFIG.IS_KLINE_START_TIME_TO_NOW) break;
  } while (startTime && startTime < now);
  return originalKlineData;
};

const getKlineData = async () => {
  const klineData = await getOriginalKlineData();
  const results = klineData.map((kline) => ({
    openPrice: Number(kline[1]),
    highPrice: Number(kline[2]),
    lowPrice: Number(kline[3]),
    closePrice: Number(kline[4]),
    volume: Number(kline[5]),
    openTime: kline[0],
    closeTime: kline[6]
  }));
  return results;
};

/** ---------- 快取變數 ---------- */
let klineCache = [];
let closePricesCache = null;
let rsiCache = new Map();

/** ---------- 快取判斷 ---------- */
// In backtest mode, only check if cache is empty (no expiration check needed)
const shouldRefreshKlineCache = (data) => {
  return data.length === 0;
};

const shouldRefreshRsiCache = () => {
  return rsiCache.size === 0;
};

/** ---------- 快取 Kline & ClosePrices ---------- */
const getKlineCache = async () => {
  if (shouldRefreshKlineCache(klineCache)) {
    const klineData = await getKlineData();
    klineCache = klineData;

    closePricesCache = new Array(klineData.length);
    for (let i = 0; i < klineData.length; i++) {
      closePricesCache[i] = klineData[i].closePrice;
    }
  }
  return klineCache;
};

const getClosePricesCache = async () => {
  if (closePricesCache) return closePricesCache;
  const klineData = await getKlineCache();
  closePricesCache = new Array(klineData.length);
  for (let i = 0; i < klineData.length; i++)
    closePricesCache[i] = klineData[i].closePrice;
  return closePricesCache;
};

/** ---------- RSI 計算 ---------- */
const computeRSI = (values, periods) => {
  const results = {};
  const valuesLength = values.length;
  if (valuesLength < 2) {
    for (const period of periods)
      results[period] = new Array(valuesLength).fill(null);
    return results;
  }

  // Pre-compute changes array once (more efficient than push in loop)
  const changesLength = valuesLength - 1;
  const changes = new Array(changesLength);
  for (let i = 0; i < changesLength; i++) {
    changes[i] = values[i + 1] - values[i];
  }

  for (const period of periods) {
    const result = new Array(valuesLength).fill(null);
    if (valuesLength < period + 1) {
      results[period] = result;
      continue;
    }

    // Initialize gain and loss
    let gain = 0;
    let loss = 0;
    for (let i = 0; i < period; i++) {
      const change = changes[i];
      if (change > 0) {
        gain += change;
      } else {
        loss -= change; // More efficient than -change
      }
    }

    // Pre-compute period multiplier for efficiency
    const periodMinusOne = period - 1;
    const periodReciprocal = 1 / period;

    // Main RSI calculation loop
    for (let i = period; i < valuesLength; i++) {
      const change = changes[i - 1];
      const maxChange = change > 0 ? change : 0;
      const maxNegChange = change < 0 ? -change : 0;

      gain = (gain * periodMinusOne + maxChange) * periodReciprocal;
      loss = (loss * periodMinusOne + maxNegChange) * periodReciprocal;

      if (loss === 0) {
        result[i] = 100;
      } else {
        result[i] = 100 - 100 / (1 + gain / loss);
      }
    }

    results[period] = result;
  }

  return results;
};

/** ---------- 快取 RSI ---------- */
const getRsiCache = async () => {
  if (shouldRefreshRsiCache()) {
    const values = await getClosePricesCache();

    const periods = [];
    for (
      let period = CONFIG.RSI_PERIOD_SETTING.min;
      period <= CONFIG.RSI_PERIOD_SETTING.max;
      period += CONFIG.RSI_PERIOD_SETTING.step
    ) {
      periods.push(period);
    }

    const results = computeRSI(values, periods);
    for (const period of periods) rsiCache.set(period, results[period]);
  }
  return rsiCache;
};

// ============================================================================
// Backtest Functions
// ============================================================================

// Only use Date formatting when logging (avoid heavy usage inside loop)
const getReadableTime = (timestamp) => {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

// Helper functions - Cache precision calculations
const precisionCache = new Map();
const getPrecisionBySize = (size) => {
  if (precisionCache.has(size)) {
    return precisionCache.get(size);
  }
  let precision;
  if (size === "1") {
    precision = 0;
  } else {
    precision = size.indexOf("1") - 1;
  }
  precisionCache.set(size, precision);
  return precision;
};

const formatBySize = (number, size) => {
  const precision = getPrecisionBySize(size);
  return Number(number.toFixed(precision));
};

const getStepSize = async () => {
  const exchangeInformation = await exchangeInformationAPI();
  const symbolData = exchangeInformation.symbols.find(
    (item) => item.symbol === CONFIG.SYMBOL
  );
  const stepSize = symbolData.filters.find(
    (filter) => filter.filterType === "LOT_SIZE"
  ).stepSize;
  return stepSize;
};

const toPercentage = (number) => `${Math.round(number * 100)}%`;
const calculateHours = (open, close) => (close - open) / CONFIG.HOUR_MS;

// ============================================================================
// BacktestEngine Class
// ============================================================================

class BacktestEngine {
  constructor(cachedKlineData, cachedRsiData, stepSize, strategyParams) {
    this.cachedKlineData = cachedKlineData;
    this.cachedRsiData = cachedRsiData;
    this.stepSize = stepSize;
    this.rsiPeriod = strategyParams.rsiPeriod;
    this.rsiLongLevel = strategyParams.rsiLongLevel;
    this.rsiShortLevel = strategyParams.rsiShortLevel;
    this.leverage = strategyParams.leverage;
    this.shouldLogResults = strategyParams.shouldLogResults || false;

    // 状态变量
    this.fund = CONFIG.INITIAL_FUNDING;
    this.positionType = "NONE";
    this.positionAmt = null;
    this.positionFund = null;
    this.openTimestamp = null;
    this.openPrice = null;
    this.liquidationPrice = null;

    // 统计数据
    this.totalTrades = 0;
    this.winningTrades = 0;
    this.losingTrades = 0;
    this.totalPnl = 0;
    this.maxDrawdown = 0;
    this.peakFund = CONFIG.INITIAL_FUNDING;
    this.totalHoldTimeHours = 0;
    this.tradeRecords = []; // 收集交易记录

    // 预计算数据
    this.rsiData = cachedRsiData.get(this.rsiPeriod);
    // Start index should be RSI period to ensure indicator is available
    this.startIndex = CONFIG.RSI_PERIOD_SETTING.max + 1;
    this.dataLength = cachedKlineData.length;

    // 预计算常量
    this.orderAmountPercent = CONFIG.ORDER_AMOUNT_PERCENT / 100;
    this.leverageReciprocal = 1 / this.leverage;
    this.liquidationMultiplier = 1 - this.leverageReciprocal;
    this.hourMsReciprocal = 1 / CONFIG.HOUR_MS;
  }

  getSignal(preRsi) {
    if (this.positionType === "NONE" && preRsi > this.rsiLongLevel) {
      return "OPEN_LONG";
    }
    if (this.positionType === "LONG" && preRsi < this.rsiShortLevel) {
      return "CLOSE_LONG";
    }
    return "NONE";
  }

  calculateFundingFee(closePrice, closeTimestamp) {
    if (!this.openTimestamp || !closeTimestamp) return 0;
    const periods = Math.floor(
      (closeTimestamp - this.openTimestamp) / CONFIG.FUNDING_PERIOD_MS
    );
    if (periods <= 0) return 0;
    return this.positionAmt * closePrice * CONFIG.FUNDING_RATE * periods;
  }

  openLongPosition(kline) {
    this.openPrice = kline.openPrice;
    const openPriceReciprocal = 1 / this.openPrice;
    const orderQuantity =
      this.fund * this.orderAmountPercent * this.leverage * openPriceReciprocal;
    this.positionAmt = formatBySize(orderQuantity, this.stepSize);
    const positionValue = this.positionAmt * this.openPrice;
    const fee = positionValue * CONFIG.FEE;
    this.positionFund = positionValue * this.leverageReciprocal;
    this.fund -= this.positionFund + fee;
    this.positionType = "LONG";
    this.openTimestamp = kline.openTime;
    this.liquidationPrice = this.openPrice * this.liquidationMultiplier;
  }

  closeLongPosition(kline) {
    const closePrice = kline.openPrice;
    const closeTimestamp = kline.openTime;
    const fee = this.positionAmt * closePrice * CONFIG.FEE;
    const fundingFee = this.calculateFundingFee(closePrice, closeTimestamp);
    const pnl =
      (closePrice - this.openPrice) * this.positionAmt - fee - fundingFee;

    if (this.shouldLogResults) {
      this.logTradeResult({
        closePrice,
        closeTimestamp,
        pnl
      });
    }

    this.fund += this.positionFund + pnl;
    this.updateTradeStats(pnl, closeTimestamp);
    this.resetPosition();
  }

  calculateFundingFeeForClose(closePrice, closeTimestamp) {
    if (!this.openTimestamp || !closeTimestamp) return 0;
    const periods = Math.floor(
      (closeTimestamp - this.openTimestamp) / CONFIG.FUNDING_PERIOD_MS
    );
    if (periods <= 0) return 0;
    return this.positionAmt * closePrice * CONFIG.FUNDING_RATE * periods;
  }

  logTradeResult({ closePrice, closeTimestamp, pnl }) {
    const finalFund = this.fund + this.positionFund + pnl;
    const pnlPercent = pnl / this.positionFund;
    const holdHours = calculateHours(this.openTimestamp, closeTimestamp);

    // 收集交易记录
    this.tradeRecords.push({
      finalFund,
      positionType: this.positionType,
      openPrice: this.openPrice,
      closePrice,
      pnl,
      pnlPercent,
      openTimestamp: this.openTimestamp,
      closeTimestamp,
      holdHours
    });
  }

  updateTradeStats(pnl, closeTimestamp) {
    this.totalTrades++;
    this.totalPnl += pnl;
    if (pnl > 0) {
      this.winningTrades++;
    } else {
      this.losingTrades++;
    }
    this.totalHoldTimeHours +=
      (closeTimestamp - this.openTimestamp) * this.hourMsReciprocal;
  }

  resetPosition() {
    this.positionType = "NONE";
    this.positionAmt = null;
    this.positionFund = null;
    this.openTimestamp = null;
    this.openPrice = null;
    this.liquidationPrice = null;
  }

  checkLiquidation(curLowPrice) {
    if (
      this.positionType === "LONG" &&
      this.liquidationPrice != null &&
      curLowPrice < this.liquidationPrice
    ) {
      return true;
    }
    return false;
  }

  updateDrawdown(curClosePrice) {
    let currentTotalFund;
    if (this.positionType === "LONG") {
      currentTotalFund =
        this.fund +
        this.positionFund +
        (curClosePrice - this.openPrice) * this.positionAmt;
    } else {
      currentTotalFund = this.fund;
    }

    if (currentTotalFund > this.peakFund) {
      this.peakFund = currentTotalFund;
    } else {
      const drawdown = (this.peakFund - currentTotalFund) / this.peakFund;
      if (drawdown > this.maxDrawdown) {
        this.maxDrawdown = drawdown;
      }
    }
  }

  closePositionAtEnd() {
    if (this.positionType !== "LONG") return;

    const lastKline = this.cachedKlineData[this.dataLength - 1];
    const closePrice = lastKline.closePrice;
    const closeTimestamp = lastKline.closeTime;
    const fee = this.positionAmt * closePrice * CONFIG.FEE;
    const fundingFee = this.calculateFundingFeeForClose(
      closePrice,
      closeTimestamp
    );
    const pnl =
      (closePrice - this.openPrice) * this.positionAmt - fee - fundingFee;

    this.fund += this.positionFund + pnl;
    this.updateTradeStats(pnl, closeTimestamp);
    this.resetPosition();
  }

  run() {
    if (!this.rsiData || this.rsiData.length === 0) return null;

    for (let i = this.startIndex; i < this.dataLength; i++) {
      const curKline = this.cachedKlineData[i];
      const curClosePrice = curKline.closePrice;
      const curLowPrice = curKline.lowPrice;

      const preRsi = this.rsiData[i - 1];

      const signal = this.getSignal(preRsi);

      if (signal === "OPEN_LONG") {
        this.openLongPosition(curKline);
      }

      if (signal === "CLOSE_LONG" && this.positionType === "LONG") {
        this.closeLongPosition(curKline);
      }

      if (this.checkLiquidation(curLowPrice)) {
        return null;
      }

      if (
        this.positionType === "LONG" ||
        this.peakFund > CONFIG.INITIAL_FUNDING
      ) {
        this.updateDrawdown(curClosePrice);
      } else {
        if (this.fund > this.peakFund) {
          this.peakFund = this.fund;
        }
      }
    }

    this.closePositionAtEnd();

    return this.getResult();
  }

  getResult() {
    return {
      currentPositionType: this.positionType,
      fund: this.fund,
      rsiPeriod: this.rsiPeriod,
      rsiLongLevel: this.rsiLongLevel,
      rsiShortLevel: this.rsiShortLevel,
      leverage: this.leverage,
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      losingTrades: this.losingTrades,
      winRate: this.totalTrades > 0 ? this.winningTrades / this.totalTrades : 0,
      totalPnl: this.totalPnl,
      totalReturn:
        (this.fund - CONFIG.INITIAL_FUNDING) / CONFIG.INITIAL_FUNDING,
      maxDrawdown: this.maxDrawdown,
      averageHoldTimeHours:
        this.totalTrades > 0 ? this.totalHoldTimeHours / this.totalTrades : 0,
      tradeRecords: this.tradeRecords
    };
  }
}

const getBacktestResult = ({
  shouldLogResults,
  cachedKlineData,
  cachedRsiData,
  stepSize,
  rsiPeriod,
  rsiLongLevel,
  rsiShortLevel,
  leverage
}) => {
  const engine = new BacktestEngine(cachedKlineData, cachedRsiData, stepSize, {
    rsiPeriod,
    rsiLongLevel,
    rsiShortLevel,
    leverage,
    shouldLogResults
  });
  return engine.run();
};

// Helper to increment numbers with decimals safely (keeps original behavior)
const getAddedNumber = ({ number, addNumber, digit }) =>
  Number((number + addNumber).toFixed(digit));

// getSettings / getRandomSettings: preserved original semantics
const getSettings = () => {
  const settings = [];
  for (
    let leverage = CONFIG.LEVERAGE_SETTING.min;
    leverage <= CONFIG.LEVERAGE_SETTING.max;
    leverage = getAddedNumber({
      number: leverage,
      addNumber: CONFIG.LEVERAGE_SETTING.step,
      digit: 0
    })
  ) {
    for (
      let rsiPeriod = CONFIG.RSI_PERIOD_SETTING.min;
      rsiPeriod <= CONFIG.RSI_PERIOD_SETTING.max;
      rsiPeriod = getAddedNumber({
        number: rsiPeriod,
        addNumber: CONFIG.RSI_PERIOD_SETTING.step,
        digit: 0
      })
    ) {
      for (
        let rsiLongLevel = CONFIG.RSI_LONG_LEVEL_SETTING.min;
        rsiLongLevel <= CONFIG.RSI_LONG_LEVEL_SETTING.max;
        rsiLongLevel = getAddedNumber({
          number: rsiLongLevel,
          addNumber: CONFIG.RSI_LONG_LEVEL_SETTING.step,
          digit: 0
        })
      ) {
        for (
          let rsiShortLevel = CONFIG.RSI_SHORT_LEVEL_SETTING.min;
          rsiShortLevel <= CONFIG.RSI_SHORT_LEVEL_SETTING.max;
          rsiShortLevel = getAddedNumber({
            number: rsiShortLevel,
            addNumber: CONFIG.RSI_SHORT_LEVEL_SETTING.step,
            digit: 0
          })
        ) {
          settings.push({
            rsiPeriod,
            rsiLongLevel,
            rsiShortLevel,
            leverage
          });
        }
      }
    }
  }
  return settings;
};

const getRandomSettings = () => {
  const settings = getSettings();
  if (CONFIG.RANDOM_SAMPLE_NUMBER) {
    const shuffled = [...settings];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(
      0,
      Math.min(CONFIG.RANDOM_SAMPLE_NUMBER, shuffled.length)
    );
  }
  return settings;
};

const getBestResult = async () => {
  const randomSettings = getRandomSettings();
  const progressBar = new SingleBar({}, Presets.shades_classic);
  progressBar.start(randomSettings.length, 0);

  let bestResult = { fund: 0, totalReturn: -1 };
  const [cachedKlineData, cachedRsiData, stepSize] = await Promise.all([
    getKlineCache(),
    getRsiCache(),
    getStepSize()
  ]);

  // Single-threaded loop over settings (keeps original behavior but with faster backtest)
  for (const setting of randomSettings) {
    const result = getBacktestResult({
      shouldLogResults: false,
      cachedKlineData,
      cachedRsiData,
      stepSize,
      ...setting
    });

    if (result && result.totalReturn > bestResult.totalReturn)
      bestResult = result;
    progressBar.increment();
  }

  progressBar.stop();

  return bestResult;
};

// ============================================================================
// Main Entry Point
// ============================================================================

const startTime = Date.now();
const bestResult = await getBestResult();
if (bestResult.fund > 0) {
  const {
    currentPositionType,
    fund,
    rsiPeriod,
    rsiLongLevel,
    rsiShortLevel,
    leverage,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    totalPnl,
    totalReturn,
    maxDrawdown,
    averageHoldTimeHours
  } = bestResult;

  const [cachedKlineData, cachedRsiData, stepSize] = await Promise.all([
    getKlineCache(),
    getRsiCache(),
    getStepSize()
  ]);

  // Run detailed backtest to get trade records
  const detailedResult = getBacktestResult({
    shouldLogResults: true,
    cachedKlineData,
    cachedRsiData,
    stepSize,
    rsiPeriod,
    rsiLongLevel,
    rsiShortLevel,
    leverage
  });

  // 计算额外统计信息
  const tradeRecords = detailedResult.tradeRecords || [];
  const sortedByPnL = [...tradeRecords].sort((a, b) => b.pnl - a.pnl);
  const bestTrade = sortedByPnL[0];
  const worstTrade = sortedByPnL[sortedByPnL.length - 1];
  const avgWin =
    winningTrades > 0
      ? tradeRecords
          .filter((t) => t.pnl > 0)
          .reduce((sum, t) => sum + t.pnl, 0) / winningTrades
      : 0;
  const avgLoss =
    losingTrades > 0
      ? tradeRecords
          .filter((t) => t.pnl < 0)
          .reduce((sum, t) => sum + t.pnl, 0) / losingTrades
      : 0;

  // Output optimized results
  console.log("\n" + "=".repeat(60));
  console.log("Backtest Results Summary");
  console.log("=".repeat(60));

  console.log("\nFund Performance");
  console.log(`  Initial Fund:     ${CONFIG.INITIAL_FUNDING.toFixed(2)}`);
  console.log(`  Final Fund:       ${fund.toFixed(2)}`);
  console.log(
    `  Total PnL:        ${totalPnl > 0 ? "+" : ""}${totalPnl.toFixed(2)}`
  );
  console.log(
    `  Total Return:     ${totalReturn > 0 ? "+" : ""}${(
      totalReturn * 100
    ).toFixed(2)}%`
  );

  console.log("\nStrategy Parameters");
  console.log(`  RSI Period:       ${rsiPeriod}`);
  console.log(`  RSI Long Level:   ${rsiLongLevel}`);
  console.log(`  RSI Short Level:  ${rsiShortLevel}`);
  console.log(`  Leverage:         ${leverage}x`);

  console.log("\nTrading Statistics");
  console.log(`  Total Trades:     ${totalTrades}`);
  console.log(
    `  Winning Trades:   ${winningTrades} (${(winRate * 100).toFixed(2)}%)`
  );
  console.log(
    `  Losing Trades:    ${losingTrades} (${((1 - winRate) * 100).toFixed(2)}%)`
  );
  console.log(`  Avg Hold Time:    ${averageHoldTimeHours.toFixed(2)} hours`);
  if (winningTrades > 0) {
    console.log(`  Avg Win:          ${avgWin.toFixed(2)}`);
  }
  if (losingTrades > 0) {
    console.log(`  Avg Loss:         ${avgLoss.toFixed(2)}`);
  }

  console.log("\nRisk Metrics");
  console.log(`  Max Drawdown:     ${(maxDrawdown * 100).toFixed(2)}%`);

  if (bestTrade) {
    console.log("\nBest Trade");
    const bestColor = "\x1b[32m";
    const resetColor = "\x1b[0m";
    console.log(
      `  ${bestColor}Profit: ${bestTrade.pnl.toFixed(2)} (${toPercentage(
        bestTrade.pnlPercent
      )})${resetColor}`
    );
    console.log(
      `  Price: ${bestTrade.openPrice.toFixed(
        2
      )} -> ${bestTrade.closePrice.toFixed(2)}`
    );
    console.log(
      `  Time: ${getReadableTime(bestTrade.openTimestamp)} ~ ${getReadableTime(
        bestTrade.closeTimestamp
      )}`
    );
    console.log(`  Hold: ${bestTrade.holdHours.toFixed(2)} hours`);
  }

  if (worstTrade) {
    console.log("\nWorst Trade");
    const worstColor = "\x1b[31m";
    const resetColor = "\x1b[0m";
    console.log(
      `  ${worstColor}Loss: ${worstTrade.pnl.toFixed(2)} (${toPercentage(
        worstTrade.pnlPercent
      )})${resetColor}`
    );
    console.log(
      `  Price: ${worstTrade.openPrice.toFixed(
        2
      )} -> ${worstTrade.closePrice.toFixed(2)}`
    );
    console.log(
      `  Time: ${getReadableTime(worstTrade.openTimestamp)} ~ ${getReadableTime(
        worstTrade.closeTimestamp
      )}`
    );
    console.log(`  Hold: ${worstTrade.holdHours.toFixed(2)} hours`);
  }

  console.log("\nPosition Status");
  console.log(`  Current Position: ${currentPositionType}`);

  // Display trade history
  if (tradeRecords.length > 0) {
    console.log("\n" + "-".repeat(60));
    console.log("Trade History");
    console.log("-".repeat(60));

    tradeRecords.forEach((trade, index) => {
      const color = trade.pnl > 0 ? "\x1b[32m" : "\x1b[31m";
      const resetColor = "\x1b[0m";
      const pnlSign = trade.pnl > 0 ? "+" : "";

      console.log(
        `${color}Fund: ${trade.finalFund.toFixed(2)} ${trade.positionType} ` +
          `[${trade.openPrice.toFixed(2)} -> ${trade.closePrice.toFixed(2)}] ` +
          `(${pnlSign}${toPercentage(trade.pnlPercent)}) ` +
          `[${getReadableTime(trade.openTimestamp)} ~ ${getReadableTime(
            trade.closeTimestamp
          )}] ` +
          `(${trade.holdHours.toFixed(2)} hrs)${resetColor}`
      );
    });
  }

  const endTime = Date.now();
  const totalRunTime = (endTime - startTime) / 1000;
  const minutes = Math.floor(totalRunTime / 60);
  const seconds = (totalRunTime % 60).toFixed(2);

  console.log("\n" + "=".repeat(60));
  console.log("Execution Time");
  if (minutes > 0) {
    console.log(
      `  Total Runtime:    ${minutes} minute(s) ${seconds} second(s)`
    );
  } else {
    console.log(`  Total Runtime:    ${seconds} second(s)`);
  }

  console.log("=".repeat(60) + "\n");
} else {
  console.log("\n" + "=".repeat(60));
  console.log("No valid result found");
  console.log("=".repeat(60) + "\n");
}
