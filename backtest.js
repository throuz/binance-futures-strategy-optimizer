import { Presets, SingleBar } from "cli-progress";
import { writeFile } from "fs/promises";

function getTimestampYearsAgo(years) {
  const currentDate = new Date();
  const targetYear = currentDate.getFullYear() - years;
  currentDate.setFullYear(targetYear);
  return currentDate.getTime();
}

const CONFIG = {
  SYMBOL: "BTCUSDT",
  ORDER_AMOUNT_PERCENT: 100,
  KLINE_INTERVAL: "1h",
  KLINE_LIMIT: 1500,
  INITIAL_FUNDING: 100,
  FEE: 0.0005,
  FUNDING_RATE: 0.0001,
  RSI_LONG_PERIOD_SETTING: { min: 5, max: 100, step: 5 },
  RSI_SHORT_PERIOD_SETTING: { min: 5, max: 100, step: 5 },
  RSI_LONG_LEVEL_SETTING: { min: 5, max: 100, step: 5 },
  RSI_SHORT_LEVEL_SETTING: { min: 5, max: 100, step: 5 },
  LEVERAGE_SETTING: { min: 1, max: 1, step: 1 },
  RANDOM_SAMPLE_NUMBER: null,
  KLINE_START_TIME: getTimestampYearsAgo(10),
  IS_KLINE_START_TIME_TO_NOW: true,
  HOUR_MS: 1000 * 60 * 60,
  FUNDING_PERIOD_MS: 8 * 1000 * 60 * 60,
  MAX_DRAWDOWN_THRESHOLD: 0.5
};

const cache = new Map();
const CACHE_TTL = 60 * 1000;

const nodeCache = {
  has(key) {
    const item = cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiry) {
      cache.delete(key);
      return false;
    }
    return true;
  },
  get(key) {
    const item = cache.get(key);
    if (!item) return undefined;
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

const BASE_URL = "https://fapi.binance.com";

const buildQueryString = (params) => {
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      queryParams.append(key, String(value));
    }
  }
  return queryParams.toString();
};

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

const exchangeInformationAPI = async () => {
  const responseData = await getBinanceFuturesAPI("/fapi/v1/exchangeInfo", {});
  return responseData;
};

const klineDataAPI = async (params) => {
  const responseData = await getBinanceFuturesAPI("/fapi/v1/klines", params);
  return responseData;
};

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

let klineCache = [];
let closePricesCache = null;
let rsiCache = new Map();

const shouldRefreshKlineCache = (data) => {
  return data.length === 0;
};

const shouldRefreshRsiCache = () => {
  return rsiCache.size === 0;
};

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

const computeRSI = (values, periods) => {
  const results = {};
  const valuesLength = values.length;
  if (valuesLength < 2) {
    for (const period of periods)
      results[period] = new Array(valuesLength).fill(null);
    return results;
  }

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

    let gain = 0;
    let loss = 0;
    for (let i = 0; i < period; i++) {
      const change = changes[i];
      if (change > 0) {
        gain += change;
      } else {
        loss -= change;
      }
    }

    const periodMinusOne = period - 1;
    const periodReciprocal = 1 / period;

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

/**
 * 收集所有需要的RSI週期
 */
const collectRSIPeriods = () => {
  const periodSet = new Set();
  const longPeriods = generateParameterRange(CONFIG.RSI_LONG_PERIOD_SETTING);
  const shortPeriods = generateParameterRange(CONFIG.RSI_SHORT_PERIOD_SETTING);

  longPeriods.forEach((period) => periodSet.add(period));
  shortPeriods.forEach((period) => periodSet.add(period));

  return Array.from(periodSet);
};

const getRsiCache = async () => {
  if (shouldRefreshRsiCache()) {
    const values = await getClosePricesCache();
    const periods = collectRSIPeriods();
    const results = computeRSI(values, periods);

    for (const period of periods) {
      rsiCache.set(period, results[period]);
    }
  }
  return rsiCache;
};

const getReadableTime = (timestamp) => {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

const getShortDate = (timestamp) => {
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

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

// ==================== Report Formatting Helper Functions ====================

/**
 * 格式化帶符號的百分比
 */
const formatSignedPercentage = (value) => {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
};

/**
 * 格式化運行時間
 */
const formatRuntime = (totalRunTime) => {
  const minutes = Math.floor(totalRunTime / 60);
  const seconds = (totalRunTime % 60).toFixed(2);
  if (minutes > 0) {
    return `${minutes} minute(s) ${seconds} second(s)`;
  }
  return `${seconds} second(s)`;
};

/**
 * 格式化交易記錄行
 */
const formatTradeRecordLine = (trade, index) => {
  const pnlSign = trade.pnl > 0 ? "+" : "";
  return `${String(index + 1).padStart(5)} | ${getReadableTime(
    trade.openTimestamp
  )} | ${getReadableTime(trade.closeTimestamp)} | ${trade.openPrice.toFixed(
    2
  )} | ${trade.closePrice.toFixed(2)} | ${pnlSign}${trade.pnl.toFixed(
    2
  )} | ${pnlSign}${toPercentage(trade.pnlPercent)} | ${trade.holdHours.toFixed(
    2
  )} | ${(trade.mae * 100).toFixed(2)}% | ${(trade.mfe * 100).toFixed(2)}%\n`;
};

/**
 * 格式化單筆交易資訊
 */
const formatTradeInfo = (trade, title) => {
  if (!trade) return "";
  const pnlSign = trade.pnl > 0 ? "+" : "";
  let info = `\n${title}\n`;
  info += `  Return: ${pnlSign}${toPercentage(trade.pnlPercent)}\n`;
  info += `  PnL:              ${pnlSign}${trade.pnl.toFixed(2)}\n`;
  info += `  Entry Price:      ${trade.openPrice.toFixed(2)}\n`;
  info += `  Exit Price:       ${trade.closePrice.toFixed(2)}\n`;
  info += `  Time:             ${getReadableTime(
    trade.openTimestamp
  )} ~ ${getReadableTime(trade.closeTimestamp)}\n`;
  info += `  Hold Time:        ${trade.holdHours.toFixed(2)} hours\n`;
  info += `  MAE:              ${(trade.mae * 100).toFixed(2)}% (${(
    trade.maeLeveraged * 100
  ).toFixed(2)}% lev)\n`;
  info += `  MFE:              ${(trade.mfe * 100).toFixed(2)}% (${(
    trade.mfeLeveraged * 100
  ).toFixed(2)}% lev)\n`;
  return info;
};

// ==================== End of Report Formatting Helper Functions ====================

const formatBacktestReport = ({
  bestResult,
  detailedResult,
  spotBuyAndHoldResult,
  tradeRecords,
  bestTrade,
  worstTrade,
  totalProfit,
  totalLoss,
  profitFactor,
  avgMAE,
  avgMFE,
  avgMAELeveraged,
  avgMFELeveraged,
  backtestStartTime,
  backtestEndTime,
  backtestDays,
  annualizedReturn,
  calmarRatio,
  sharpeRatio,
  sortinoRatio,
  exposure,
  totalRunTime
}) => {
  const {
    currentPositionType,
    fund,
    rsiLongPeriod,
    rsiShortPeriod,
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

  let report = "\n" + "=".repeat(60) + "\n";
  report += "Backtest Results Summary\n";
  report += "=".repeat(60) + "\n";

  report += "\nCore Performance\n";
  report += `  Final Fund:       ${fund.toFixed(2)}\n`;
  report += `  Total Return:     ${formatSignedPercentage(totalReturn)}\n`;
  if (backtestDays > 0) {
    report += `  Annualized Return: ${formatSignedPercentage(
      annualizedReturn
    )}\n`;
  }

  if (spotBuyAndHoldResult) {
    const returnDiff = totalReturn - spotBuyAndHoldResult.totalReturn;
    const returnDiffPercent = returnDiff * 100;
    const outperformance = returnDiff >= 0 ? "OUTPERFORMS" : "UNDERPERFORMS";
    report += `  vs Spot Holder: ${outperformance} by ${Math.abs(
      returnDiffPercent
    ).toFixed(2)}%\n`;
  }

  report += "\nStrategy Parameters\n";
  report += `  RSI Long Period:  ${rsiLongPeriod}\n`;
  report += `  RSI Short Period: ${rsiShortPeriod}\n`;
  report += `  RSI Long Level:   ${rsiLongLevel}\n`;
  report += `  RSI Short Level:  ${rsiShortLevel}\n`;
  report += `  Leverage:         ${leverage}x\n`;

  report += "\nRisk Metrics\n";
  report += `  Max Drawdown:     ${(maxDrawdown * 100).toFixed(2)}%\n`;
  if (calmarRatio !== Infinity && calmarRatio > 0) {
    report += `  Calmar Ratio:     ${calmarRatio.toFixed(2)}\n`;
  } else if (calmarRatio === Infinity) {
    report += `  Calmar Ratio:     ∞ (No drawdown)\n`;
  }
  if (sharpeRatio !== 0) {
    report += `  Sharpe Ratio:     ${sharpeRatio.toFixed(2)}\n`;
  }
  if (sortinoRatio !== 0) {
    report += `  Sortino Ratio:    ${sortinoRatio.toFixed(2)}\n`;
  }

  report += "\nTrading Statistics\n";
  report += `  Total Trades:     ${totalTrades}\n`;
  report += `  Win Rate:         ${(winRate * 100).toFixed(2)}%\n`;
  if (profitFactor !== Infinity && profitFactor > 0) {
    report += `  Profit Factor:    ${profitFactor.toFixed(2)}\n`;
  } else if (profitFactor === Infinity) {
    report += `  Profit Factor:    ∞ (No losses)\n`;
  }
  report += `  Avg Hold Time:    ${averageHoldTimeHours.toFixed(2)} hours\n`;
  report += `  Exposure:         ${exposure.toFixed(2)}%\n`;
  if (tradeRecords.length > 0) {
    report += `  Avg MAE:          ${(avgMAE * 100).toFixed(2)}% (${(
      avgMAELeveraged * 100
    ).toFixed(2)}% lev)\n`;
    report += `  Avg MFE:          ${(avgMFE * 100).toFixed(2)}% (${(
      avgMFELeveraged * 100
    ).toFixed(2)}% lev)\n`;
  }

  report += "\nBacktest Period\n";
  report += `  Duration:         ${backtestDays.toFixed(2)} days\n`;
  report += `  ${getReadableTime(backtestStartTime)} ~ ${getReadableTime(
    backtestEndTime
  )}\n`;

  report += formatTradeInfo(bestTrade, "Best Trade");
  report += formatTradeInfo(worstTrade, "Worst Trade");

  report += "\n" + "=".repeat(60) + "\n";
  report += "Execution Time\n";
  report += `  Total Runtime:    ${formatRuntime(totalRunTime)}\n`;
  report += "=".repeat(60) + "\n";

  // Add detailed trade records
  if (tradeRecords.length > 0) {
    report += "\n" + "=".repeat(60) + "\n";
    report += "Detailed Trade Records\n";
    report += "=".repeat(60) + "\n\n";
    report +=
      "Index | Entry Time | Exit Time | Entry Price | Exit Price | PnL | PnL % | Hold Hours | MAE | MFE\n";
    report += "-".repeat(120) + "\n";
    tradeRecords.forEach((trade, index) => {
      report += formatTradeRecordLine(trade, index);
    });
  }

  return report;
};

class BacktestEngine {
  constructor(cachedKlineData, cachedRsiData, stepSize, strategyParams) {
    this.cachedKlineData = cachedKlineData;
    this.stepSize = stepSize;
    this.rsiLongPeriod = strategyParams.rsiLongPeriod;
    this.rsiShortPeriod = strategyParams.rsiShortPeriod;
    this.rsiLongLevel = strategyParams.rsiLongLevel;
    this.rsiShortLevel = strategyParams.rsiShortLevel;
    this.leverage = strategyParams.leverage;
    this.shouldLogResults = strategyParams.shouldLogResults || false;
    this.maxDrawdownThreshold = strategyParams.maxDrawdownThreshold || null;

    this.fund = CONFIG.INITIAL_FUNDING;
    this.positionType = "NONE";
    this.positionAmt = null;
    this.positionFund = null;
    this.openTimestamp = null;
    this.openPrice = null;
    this.liquidationPrice = null;
    this.positionMaxPrice = null;
    this.positionMinPrice = null;

    this.totalTrades = 0;
    this.winningTrades = 0;
    this.losingTrades = 0;
    this.totalPnl = 0;
    this.maxDrawdown = 0;
    this.peakFund = CONFIG.INITIAL_FUNDING;
    this.totalHoldTimeHours = 0;
    this.tradeRecords = [];

    this.rsiLongData = cachedRsiData.get(this.rsiLongPeriod);
    this.rsiShortData = cachedRsiData.get(this.rsiShortPeriod);
    this.startIndex = Math.max(this.rsiLongPeriod, this.rsiShortPeriod) + 1;
    this.dataLength = cachedKlineData.length;

    this.orderAmountPercent = CONFIG.ORDER_AMOUNT_PERCENT / 100;
    this.leverageReciprocal = 1 / this.leverage;
    this.liquidationMultiplier = 1 - this.leverageReciprocal;
    this.hourMsReciprocal = 1 / CONFIG.HOUR_MS;
  }

  getSignal(preRsiLong, preRsiShort) {
    if (this.positionType === "NONE" && preRsiLong > this.rsiLongLevel) {
      return "OPEN_LONG";
    }
    if (this.positionType === "LONG" && preRsiShort < this.rsiShortLevel) {
      return "CLOSE_LONG";
    }
    return "NONE";
  }

  /**
   * 計算資金費用的週期數
   */
  calculateFundingPeriods(closeTimestamp) {
    if (!this.openTimestamp || !closeTimestamp) return 0;
    const periods = Math.floor(
      (closeTimestamp - this.openTimestamp) / CONFIG.FUNDING_PERIOD_MS
    );
    return periods > 0 ? periods : 0;
  }

  calculateFundingFee(closePrice, closeTimestamp) {
    const periods = this.calculateFundingPeriods(closeTimestamp);
    if (periods === 0) return 0;
    return this.positionAmt * closePrice * CONFIG.FUNDING_RATE * periods;
  }

  /**
   * 計算訂單數量
   */
  calculateOrderQuantity(price) {
    const priceReciprocal = 1 / price;
    return (
      this.fund * this.orderAmountPercent * this.leverage * priceReciprocal
    );
  }

  /**
   * 計算持倉價值和費用
   */
  calculatePositionValueAndFee(positionAmount, price) {
    const positionValue = positionAmount * price;
    const fee = positionValue * CONFIG.FEE;
    const positionFund = positionValue * this.leverageReciprocal;
    return { positionValue, fee, positionFund };
  }

  openLongPosition(kline) {
    this.openPrice = kline.openPrice;
    const orderQuantity = this.calculateOrderQuantity(this.openPrice);
    this.positionAmt = formatBySize(orderQuantity, this.stepSize);
    const { fee, positionFund } = this.calculatePositionValueAndFee(
      this.positionAmt,
      this.openPrice
    );

    this.positionFund = positionFund;
    this.fund -= this.positionFund + fee;
    this.positionType = "LONG";
    this.openTimestamp = kline.openTime;
    this.liquidationPrice = this.openPrice * this.liquidationMultiplier;
    this.positionMaxPrice = kline.highPrice;
    this.positionMinPrice = kline.lowPrice;
  }

  /**
   * 計算平倉的PnL
   */
  calculateClosePnL(closePrice, closeTimestamp) {
    const fee = this.positionAmt * closePrice * CONFIG.FEE;
    const fundingFee = this.calculateFundingFee(closePrice, closeTimestamp);
    const priceChange = (closePrice - this.openPrice) * this.positionAmt;
    return priceChange - fee - fundingFee;
  }

  closeLongPosition(kline) {
    const closePrice = kline.openPrice;
    const closeTimestamp = kline.openTime;
    const pnl = this.calculateClosePnL(closePrice, closeTimestamp);

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
    return this.calculateFundingFee(closePrice, closeTimestamp);
  }

  /**
   * 計算MAE和MFE（最大不利偏移和最大有利偏移）
   */
  calculateMAEAndMFE() {
    if (
      this.positionType !== "LONG" ||
      !this.positionMinPrice ||
      !this.positionMaxPrice
    ) {
      return {
        mae: 0,
        mfe: 0,
        maeLeveraged: 0,
        mfeLeveraged: 0
      };
    }

    const mae = -(this.openPrice - this.positionMinPrice) / this.openPrice;
    const mfe = (this.positionMaxPrice - this.openPrice) / this.openPrice;
    return {
      mae,
      mfe,
      maeLeveraged: mae * this.leverage,
      mfeLeveraged: mfe * this.leverage
    };
  }

  logTradeResult({ closePrice, closeTimestamp, pnl }) {
    const finalFund = this.fund + this.positionFund + pnl;
    const pnlPercent = pnl / this.positionFund;
    const holdHours = calculateHours(this.openTimestamp, closeTimestamp);
    const { mae, mfe, maeLeveraged, mfeLeveraged } = this.calculateMAEAndMFE();

    this.tradeRecords.push({
      finalFund,
      positionType: this.positionType,
      openPrice: this.openPrice,
      closePrice,
      pnl,
      pnlPercent,
      openTimestamp: this.openTimestamp,
      closeTimestamp,
      holdHours,
      mae,
      mfe,
      maeLeveraged,
      mfeLeveraged
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
    this.positionMaxPrice = null;
    this.positionMinPrice = null;
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

  /**
   * 計算當前總資金
   */
  calculateCurrentTotalFund(curClosePrice) {
    if (this.positionType === "LONG") {
      return (
        this.fund +
        this.positionFund +
        (curClosePrice - this.openPrice) * this.positionAmt
      );
    }
    return this.fund;
  }

  updateDrawdown(curClosePrice) {
    const currentTotalFund = this.calculateCurrentTotalFund(curClosePrice);

    if (currentTotalFund > this.peakFund) {
      this.peakFund = currentTotalFund;
    } else {
      const drawdown = (this.peakFund - currentTotalFund) / this.peakFund;
      if (drawdown > this.maxDrawdown) {
        this.maxDrawdown = drawdown;
      }
    }
  }

  isDrawdownExceeded() {
    if (this.maxDrawdownThreshold === null) return false;
    return this.maxDrawdown > this.maxDrawdownThreshold;
  }

  /**
   * 更新持倉的最高價和最低價
   */
  updatePositionPriceRange(highPrice, lowPrice) {
    if (highPrice > this.positionMaxPrice) {
      this.positionMaxPrice = highPrice;
    }
    if (lowPrice < this.positionMinPrice) {
      this.positionMinPrice = lowPrice;
    }
  }

  closePositionAtEnd() {
    if (this.positionType !== "LONG") return;

    const lastKline = this.cachedKlineData[this.dataLength - 1];
    const closePrice = lastKline.closePrice;
    const closeTimestamp = lastKline.closeTime;

    this.updatePositionPriceRange(lastKline.highPrice, lastKline.lowPrice);
    const pnl = this.calculateClosePnL(closePrice, closeTimestamp);

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

  run() {
    if (
      !this.rsiLongData ||
      this.rsiLongData.length === 0 ||
      !this.rsiShortData ||
      this.rsiShortData.length === 0
    )
      return null;

    for (let i = this.startIndex; i < this.dataLength; i++) {
      const curKline = this.cachedKlineData[i];
      const curClosePrice = curKline.closePrice;
      const curLowPrice = curKline.lowPrice;
      const curHighPrice = curKline.highPrice;

      const preRsiLong = this.rsiLongData[i - 1];
      const preRsiShort = this.rsiShortData[i - 1];

      if (preRsiLong == null || preRsiShort == null) {
        continue;
      }

      if (this.positionType === "LONG") {
        this.updatePositionPriceRange(curHighPrice, curLowPrice);
      }

      const signal = this.getSignal(preRsiLong, preRsiShort);

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
        if (this.isDrawdownExceeded()) {
          return null;
        }
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
      rsiLongPeriod: this.rsiLongPeriod,
      rsiShortPeriod: this.rsiShortPeriod,
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
  rsiLongPeriod,
  rsiShortPeriod,
  rsiLongLevel,
  rsiShortLevel,
  leverage,
  maxDrawdownThreshold = null
}) => {
  const engine = new BacktestEngine(cachedKlineData, cachedRsiData, stepSize, {
    rsiLongPeriod,
    rsiShortPeriod,
    rsiLongLevel,
    rsiShortLevel,
    leverage,
    shouldLogResults,
    maxDrawdownThreshold
  });
  return engine.run();
};

// ==================== Calculation Helper Functions ====================

/**
 * 計算交易統計數據
 */
const calculateTradeStatistics = (tradeRecords) => {
  const winningTrades = tradeRecords.filter((t) => t.pnl > 0);
  const losingTrades = tradeRecords.filter((t) => t.pnl < 0);

  const totalProfit =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0)
      : 0;

  const totalLoss =
    losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0))
      : 0;

  const profitFactor =
    totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  return { totalProfit, totalLoss, profitFactor };
};

/**
 * 計算平均MAE和MFE
 */
const calculateAverageMAEAndMFE = (tradeRecords) => {
  if (tradeRecords.length === 0) {
    return {
      avgMAE: 0,
      avgMFE: 0,
      avgMAELeveraged: 0,
      avgMFELeveraged: 0
    };
  }

  const totalMAE = tradeRecords.reduce((sum, t) => sum + t.mae, 0);
  const totalMFE = tradeRecords.reduce((sum, t) => sum + t.mfe, 0);
  const totalMAELeveraged = tradeRecords.reduce(
    (sum, t) => sum + t.maeLeveraged,
    0
  );
  const totalMFELeveraged = tradeRecords.reduce(
    (sum, t) => sum + t.mfeLeveraged,
    0
  );

  const length = tradeRecords.length;
  return {
    avgMAE: totalMAE / length,
    avgMFE: totalMFE / length,
    avgMAELeveraged: totalMAELeveraged / length,
    avgMFELeveraged: totalMFELeveraged / length
  };
};

/**
 * 計算年化報酬率
 */
const calculateAnnualizedReturn = (totalReturn, backtestDays) => {
  return backtestDays > 0
    ? Math.pow(1 + totalReturn, 365 / backtestDays) - 1
    : 0;
};

/**
 * 計算Calmar Ratio
 */
const calculateCalmarRatio = (annualizedReturn, maxDrawdown) => {
  if (maxDrawdown > 0) {
    return annualizedReturn / maxDrawdown;
  }
  return annualizedReturn > 0 ? Infinity : 0;
};

/**
 * 計算週期性回報和持倉時間
 */
const calculatePeriodicReturnsAndExposure = (
  tradeRecords,
  backtestStartTime,
  backtestEndTime
) => {
  const periodicReturns = [];
  let previousFund = CONFIG.INITIAL_FUNDING;
  let totalPositionTime = 0;

  for (const trade of tradeRecords) {
    const periodReturn = (trade.finalFund - previousFund) / previousFund;
    periodicReturns.push(periodReturn);
    previousFund = trade.finalFund;
    totalPositionTime += trade.closeTimestamp - trade.openTimestamp;
  }

  const totalBacktestTime = backtestEndTime - backtestStartTime;
  const exposure =
    totalBacktestTime > 0 ? (totalPositionTime / totalBacktestTime) * 100 : 0;

  return { periodicReturns, exposure };
};

/**
 * 計算Sharpe Ratio
 */
const calculateSharpeRatio = (periodicReturns, backtestDays) => {
  if (periodicReturns.length <= 1) return 0;

  const meanReturn =
    periodicReturns.reduce((a, b) => a + b, 0) / periodicReturns.length;
  const variance =
    periodicReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
    (periodicReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev <= 0 || backtestDays <= 0) return 0;

  const tradesPerYear = (periodicReturns.length / backtestDays) * 365;
  const annualizedStdDev = stdDev * Math.sqrt(tradesPerYear);
  const annualizedMeanReturn = meanReturn * tradesPerYear;

  return annualizedMeanReturn / annualizedStdDev;
};

/**
 * 計算Sortino Ratio
 */
const calculateSortinoRatio = (periodicReturns, backtestDays) => {
  if (periodicReturns.length <= 1) return 0;

  const meanReturn =
    periodicReturns.reduce((a, b) => a + b, 0) / periodicReturns.length;
  const downsideReturns = periodicReturns.filter((r) => r < 0);

  if (downsideReturns.length === 0) return 0;

  const downsideVariance =
    downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) /
    downsideReturns.length;
  const downsideStdDev = Math.sqrt(downsideVariance);

  if (downsideStdDev <= 0 || backtestDays <= 0) return 0;

  const tradesPerYear = (periodicReturns.length / backtestDays) * 365;
  const annualizedStdDev = downsideStdDev * Math.sqrt(tradesPerYear);
  const annualizedMeanReturn = meanReturn * tradesPerYear;

  return annualizedMeanReturn / annualizedStdDev;
};

/**
 * 提取最佳和最差交易
 */
const extractBestAndWorstTrades = (tradeRecords) => {
  if (tradeRecords.length === 0) {
    return { bestTrade: undefined, worstTrade: undefined };
  }

  const sortedByPnLPercent = [...tradeRecords].sort(
    (a, b) => b.pnlPercent - a.pnlPercent
  );

  return {
    bestTrade: sortedByPnLPercent[0],
    worstTrade: sortedByPnLPercent[sortedByPnLPercent.length - 1]
  };
};

/**
 * 計算回測期間資訊
 */
const calculateBacktestPeriod = (cachedKlineData) => {
  const firstKline = cachedKlineData[0];
  const lastKline = cachedKlineData[cachedKlineData.length - 1];
  const backtestStartTime = firstKline.openTime;
  const backtestEndTime = lastKline.closeTime;
  const backtestDays =
    (backtestEndTime - backtestStartTime) / (1000 * 60 * 60 * 24);

  return { backtestStartTime, backtestEndTime, backtestDays };
};

/**
 * 計算所有回測報告所需的指標
 */
const calculateAllBacktestMetrics = (
  bestResult,
  detailedResult,
  cachedKlineData
) => {
  const tradeRecords = detailedResult.tradeRecords || [];
  const { totalReturn, maxDrawdown } = bestResult;

  // 提取最佳和最差交易
  const { bestTrade, worstTrade } = extractBestAndWorstTrades(tradeRecords);

  // 計算交易統計
  const { totalProfit, totalLoss, profitFactor } =
    calculateTradeStatistics(tradeRecords);

  // 計算平均MAE/MFE
  const { avgMAE, avgMFE, avgMAELeveraged, avgMFELeveraged } =
    calculateAverageMAEAndMFE(tradeRecords);

  // 計算回測期間
  const { backtestStartTime, backtestEndTime, backtestDays } =
    calculateBacktestPeriod(cachedKlineData);

  // 計算年化報酬率和風險指標
  const annualizedReturn = calculateAnnualizedReturn(totalReturn, backtestDays);
  const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);

  // 計算週期性回報和持倉時間
  const { periodicReturns, exposure } = calculatePeriodicReturnsAndExposure(
    tradeRecords,
    backtestStartTime,
    backtestEndTime
  );

  // 計算風險調整後報酬率
  const sharpeRatio = calculateSharpeRatio(periodicReturns, backtestDays);
  const sortinoRatio = calculateSortinoRatio(periodicReturns, backtestDays);

  return {
    bestTrade,
    worstTrade,
    totalProfit,
    totalLoss,
    profitFactor,
    avgMAE,
    avgMFE,
    avgMAELeveraged,
    avgMFELeveraged,
    backtestStartTime,
    backtestEndTime,
    backtestDays,
    annualizedReturn,
    calmarRatio,
    sharpeRatio,
    sortinoRatio,
    exposure
  };
};

// ==================== End of Calculation Helper Functions ====================

const getSpotBuyAndHoldResult = (cachedKlineData, stepSize) => {
  if (!cachedKlineData || cachedKlineData.length === 0) {
    return null;
  }

  const firstKline = cachedKlineData[0];
  const lastKline = cachedKlineData[cachedKlineData.length - 1];

  const buyPrice = firstKline.openPrice;
  const sellPrice = lastKline.closePrice;
  const initialFund = CONFIG.INITIAL_FUNDING;

  const orderAmountPercent = CONFIG.ORDER_AMOUNT_PERCENT / 100;
  const openPriceReciprocal = 1 / buyPrice;
  const orderQuantity = initialFund * orderAmountPercent * openPriceReciprocal;
  const positionAmt = formatBySize(orderQuantity, stepSize);
  const positionValue = positionAmt * buyPrice;
  const openFee = positionValue * CONFIG.FEE;

  const closeFee = positionAmt * sellPrice * CONFIG.FEE;
  const pnl = (sellPrice - buyPrice) * positionAmt - closeFee;
  const finalFund = initialFund - positionValue - openFee + positionValue + pnl;

  const totalReturn = (finalFund - initialFund) / initialFund;

  return {
    finalFund,
    totalReturn
  };
};

const getAddedNumber = ({ number, addNumber, digit }) =>
  Number((number + addNumber).toFixed(digit));

/**
 * 生成參數範圍數組
 */
const generateParameterRange = (setting) => {
  const range = [];
  for (
    let value = setting.min;
    value <= setting.max;
    value = getAddedNumber({
      number: value,
      addNumber: setting.step,
      digit: 0
    })
  ) {
    range.push(value);
  }
  return range;
};

/**
 * 生成所有策略參數組合
 */
const getSettings = () => {
  const settings = [];
  const leverageRange = generateParameterRange(CONFIG.LEVERAGE_SETTING);
  const rsiLongPeriodRange = generateParameterRange(
    CONFIG.RSI_LONG_PERIOD_SETTING
  );
  const rsiShortPeriodRange = generateParameterRange(
    CONFIG.RSI_SHORT_PERIOD_SETTING
  );
  const rsiLongLevelRange = generateParameterRange(
    CONFIG.RSI_LONG_LEVEL_SETTING
  );
  const rsiShortLevelRange = generateParameterRange(
    CONFIG.RSI_SHORT_LEVEL_SETTING
  );

  for (const leverage of leverageRange) {
    for (const rsiLongPeriod of rsiLongPeriodRange) {
      for (const rsiShortPeriod of rsiShortPeriodRange) {
        for (const rsiLongLevel of rsiLongLevelRange) {
          for (const rsiShortLevel of rsiShortLevelRange) {
            settings.push({
              rsiLongPeriod,
              rsiShortPeriod,
              rsiLongLevel,
              rsiShortLevel,
              leverage
            });
          }
        }
      }
    }
  }

  return settings;
};

/**
 * Fisher-Yates 洗牌算法
 */
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getRandomSettings = () => {
  const settings = getSettings();
  if (CONFIG.RANDOM_SAMPLE_NUMBER) {
    const shuffled = shuffleArray(settings);
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

  for (const setting of randomSettings) {
    const result = getBacktestResult({
      shouldLogResults: false,
      cachedKlineData,
      cachedRsiData,
      stepSize,
      maxDrawdownThreshold: CONFIG.MAX_DRAWDOWN_THRESHOLD,
      ...setting
    });

    if (result && result.totalReturn > bestResult.totalReturn) {
      bestResult = result;
    }
    progressBar.increment();
  }

  progressBar.stop();

  return bestResult;
};

const startTime = Date.now();
const bestResult = await getBestResult();
if (bestResult.fund > 0) {
  const {
    currentPositionType,
    fund,
    rsiLongPeriod,
    rsiShortPeriod,
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

  const detailedResult = getBacktestResult({
    shouldLogResults: true,
    cachedKlineData,
    cachedRsiData,
    stepSize,
    rsiLongPeriod,
    rsiShortPeriod,
    rsiLongLevel,
    rsiShortLevel,
    leverage
  });

  const spotBuyAndHoldResult = getSpotBuyAndHoldResult(
    cachedKlineData,
    stepSize
  );

  // 計算所有回測指標
  const {
    bestTrade,
    worstTrade,
    totalProfit,
    totalLoss,
    profitFactor,
    avgMAE,
    avgMFE,
    avgMAELeveraged,
    avgMFELeveraged,
    backtestStartTime,
    backtestEndTime,
    backtestDays,
    annualizedReturn,
    calmarRatio,
    sharpeRatio,
    sortinoRatio,
    exposure
  } = calculateAllBacktestMetrics(bestResult, detailedResult, cachedKlineData);

  const tradeRecords = detailedResult.tradeRecords || [];

  const endTime = Date.now();
  const totalRunTime = (endTime - startTime) / 1000;

  const report = formatBacktestReport({
    bestResult,
    detailedResult,
    spotBuyAndHoldResult,
    tradeRecords,
    bestTrade,
    worstTrade,
    totalProfit,
    totalLoss,
    profitFactor,
    avgMAE,
    avgMFE,
    avgMAELeveraged,
    avgMFELeveraged,
    backtestStartTime,
    backtestEndTime,
    backtestDays,
    annualizedReturn,
    calmarRatio,
    sharpeRatio,
    sortinoRatio,
    exposure,
    totalRunTime
  });

  /**
   * 生成報告文件名
   */
  const generateReportFilename = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `backtest-report-${timestamp}.txt`;
  };

  /**
   * 保存報告到文件
   */
  const saveReportToFile = async (report) => {
    const filename = generateReportFilename();
    await writeFile(filename, report, "utf-8");
    return filename;
  };

  // Write report to file
  const filename = await saveReportToFile(report);

  // Only log minimal info
  console.log("\n✓ Backtest completed successfully");
  console.log(`✓ Report saved to: ${filename}`);
} else {
  const report =
    "\n" + "=".repeat(60) + "\nNo valid result found\n" + "=".repeat(60) + "\n";
  const filename = await saveReportToFile(report);
  console.log("\n✗ No valid result found");
  console.log(`✓ Report saved to: ${filename}`);
}
