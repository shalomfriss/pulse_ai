const STRATEGIES = [
  { id: "buy-hold", name: "Buy & hold", description: "Invest once and hold through the selected period.", defaults: {} },
  { id: "sma-crossover", name: "SMA crossover", description: "Own the asset while the fast moving average is above the slow moving average.", defaults: { fastPeriod: 20, slowPeriod: 50 } },
  { id: "rsi-reversion", name: "RSI mean reversion", description: "Buy oversold conditions and exit after RSI recovers.", defaults: { rsiPeriod: 14, oversold: 30, exitLevel: 55 } },
  { id: "breakout", name: "Donchian breakout", description: "Buy a new lookback high and exit on a shorter lookback low.", defaults: { entryPeriod: 20, exitPeriod: 10 } },
];

export const strategyCatalog = STRATEGIES;
export const MAX_BARS = 300_000;

const finite = (value) => Number.isFinite(Number(value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stdev = (values) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

export function compileBars(input, maxBars = MAX_BARS) {
  if (!Array.isArray(input)) throw new Error("Historical bars must be an array");
  if (input.length > maxBars) throw new Error(`Historical data exceeds the ${maxBars.toLocaleString("en-US")}-bar limit`);
  let invalidRemoved = 0;
  const normalized = [];
  for (const item of input) {
    const timestampValue = String(item?.timestamp ?? item?.t ?? item?.date ?? "");
    const timestampMillis = Date.parse(timestampValue);
    const bar = {
      timestamp: Number.isFinite(timestampMillis) ? new Date(timestampMillis).toISOString() : "",
      open: Number(item?.open ?? item?.o),
      high: Number(item?.high ?? item?.h),
      low: Number(item?.low ?? item?.l),
      close: Number(item?.close ?? item?.c),
      volume: Number(item?.volume ?? item?.v ?? 0),
    };
    if (!bar.timestamp || ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(finite) || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.high > 1e12 || bar.volume > 1e18 || bar.high < bar.low || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high || bar.volume < 0) {
      invalidRemoved += 1;
      continue;
    }
    normalized.push(bar);
  }
  normalized.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byTimestamp = new Map();
  for (const bar of normalized) {
    byTimestamp.set(bar.timestamp, bar);
  }
  const bars = [...byTimestamp.values()];
  if (invalidRemoved===input.length) throw new Error("Historical values exceed the safe numeric range");
  if (bars.length < 2) throw new Error("At least two valid historical bars are required");
  return {
    bars,
    report: {
      inputRows: input.length,
      validRows: bars.length,
      invalidRemoved,
      duplicatesRemoved: normalized.length - bars.length,
      start: bars[0].timestamp,
      end: bars.at(-1).timestamp,
    },
  };
}

function period(value, fallback, label) {
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed) || parsed < 2 || parsed > 500) throw new Error(`${label} must be between 2 and 500`);
  return parsed;
}

function strategySignals(bars, strategy, parameters) {
  const closes = bars.map((bar) => bar.close);
  const signals = Array(bars.length).fill(false);
  if (strategy === "buy-hold") {
    signals.fill(true);
    return signals;
  }
  if (strategy === "sma-crossover") {
    const fast = period(parameters.fastPeriod, 20, "Fast period");
    const slow = period(parameters.slowPeriod, 50, "Slow period");
    if (fast >= slow) throw new Error("Fast period must be less than slow period");
    for (let index = slow - 1; index < bars.length; index += 1) {
      signals[index] = average(closes.slice(index - fast + 1, index + 1)) > average(closes.slice(index - slow + 1, index + 1));
    }
    return signals;
  }
  if (strategy === "rsi-reversion") {
    const rsiPeriod = period(parameters.rsiPeriod, 14, "RSI period");
    const oversold = Number(parameters.oversold ?? 30);
    const exitLevel = Number(parameters.exitLevel ?? 55);
    if (!(oversold > 0 && oversold < exitLevel && exitLevel < 100)) throw new Error("RSI levels must satisfy 0 < oversold < exit level < 100");
    let holding = false;
    for (let index = rsiPeriod; index < bars.length; index += 1) {
      const changes = closes.slice(index - rsiPeriod, index + 1).slice(1).map((close, offset) => close - closes[index - rsiPeriod + offset]);
      const gains = average(changes.map((change) => Math.max(0, change)));
      const losses = average(changes.map((change) => Math.max(0, -change)));
      const rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
      if (!holding && rsi < oversold) holding = true;
      else if (holding && rsi > exitLevel) holding = false;
      signals[index] = holding;
    }
    return signals;
  }
  if (strategy === "breakout") {
    const entry = period(parameters.entryPeriod, 20, "Entry period");
    const exit = period(parameters.exitPeriod, 10, "Exit period");
    let holding = false;
    for (let index = Math.max(entry, exit); index < bars.length; index += 1) {
      const priorHigh = Math.max(...bars.slice(index - entry, index).map((bar) => bar.high));
      const priorLow = Math.min(...bars.slice(index - exit, index).map((bar) => bar.low));
      if (!holding && bars[index].close > priorHigh) holding = true;
      else if (holding && bars[index].close < priorLow) holding = false;
      signals[index] = holding;
    }
    return signals;
  }
  throw new Error("Unknown backtesting strategy");
}

export function runBacktest(input) {
  const { bars, report } = compileBars(input.bars);
  const initialCapital = Number(input.initialCapital);
  const commission = Number(input.commission ?? 0);
  const slippageBps = Number(input.slippageBps ?? 0);
  if (!finite(initialCapital) || initialCapital <= 0 || initialCapital > 1e12) throw new Error("Initial capital must be within the safe numeric range");
  if (!finite(commission) || commission < 0 || commission >= initialCapital) throw new Error("Commission must be nonnegative and less than initial capital");
  if (!finite(slippageBps) || slippageBps < 0 || slippageBps > 1_000) throw new Error("Slippage must be between 0 and 1,000 basis points");
  const signals = strategySignals(bars, input.strategy, input.parameters ?? {});
  let cash = initialCapital;
  let quantity = 0;
  let entry = null;
  let investedBars = 0;
  let fillCount = 0;
  let benchmarkCash = initialCapital;
  let benchmarkQuantity = 0;
  const trades = [];
  const equityCurve = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (index === 1) {
      const benchmarkEntryPrice = bar.open * (1 + slippageBps / 10_000);
      benchmarkQuantity = (benchmarkCash - commission) / benchmarkEntryPrice;
      benchmarkCash -= benchmarkQuantity * benchmarkEntryPrice + commission;
    }
    if (index > 0) {
      const shouldHold = signals[index - 1];
      if (shouldHold && quantity === 0 && cash > commission) {
        const price = bar.open * (1 + slippageBps / 10_000);
        const available = Math.max(0, cash - commission);
        quantity = available / price;
        cash -= quantity * price + commission;
        fillCount += 1;
        entry = { time: bar.timestamp, price, quantity, commission, index };
      } else if (!shouldHold && quantity > 0) {
        const price = bar.open * (1 - slippageBps / 10_000);
        const proceeds = Math.max(0,quantity * price - commission);
        cash += proceeds;
        fillCount += 1;
        const invested = entry.quantity * entry.price + entry.commission;
        const pnl = proceeds - invested;
        trades.push({
          entryTime: entry.time, exitTime: bar.timestamp, entryPrice: round(entry.price), exitPrice: round(price), quantity: round(quantity, 6),
          pnl: round(pnl), returnPct: round(pnl / invested * 100), barsHeld: index - entry.index,
        });
        quantity = 0;
        entry = null;
      }
    }
    if (quantity > 0) investedBars += 1;
    equityCurve.push({ timestamp: bar.timestamp, equity: round(cash + quantity * bar.close), benchmark: round(benchmarkCash + benchmarkQuantity * bar.close) });
  }

  if (quantity > 0) {
    const bar = bars.at(-1);
    const price = bar.close * (1 - slippageBps / 10_000);
    const proceeds = Math.max(0,quantity * price - commission);
    cash += proceeds;
    fillCount += 1;
    const invested = entry.quantity * entry.price + entry.commission;
    const pnl = proceeds - invested;
    trades.push({
      entryTime: entry.time, exitTime: bar.timestamp, entryPrice: round(entry.price), exitPrice: round(price), quantity: round(quantity, 6),
      pnl: round(pnl), returnPct: round(pnl / invested * 100), barsHeld: bars.length - 1 - entry.index,
    });
    equityCurve[equityCurve.length - 1].equity = round(cash);
  }
  const benchmarkExitPrice = bars.at(-1).close * (1 - slippageBps / 10_000);
  benchmarkCash += Math.max(0,benchmarkQuantity * benchmarkExitPrice - commission);
  equityCurve[equityCurve.length - 1].benchmark = round(benchmarkCash);

  const returns = equityCurve.slice(1).map((point, index) => point.equity / equityCurve[index].equity - 1);
  let peak = equityCurve[0].equity;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }
  const totalReturn = cash / initialCapital - 1;
  const elapsedDays = Math.max(1, (Date.parse(bars.at(-1).timestamp) - Date.parse(bars[0].timestamp)) / 86_400_000);
  const annualized = totalReturn<=-1?-1:(1 + totalReturn) ** (365.25 / elapsedDays) - 1;
  const annualPeriods = { "1Day":252,"1Hour":1_638,"15Min":6_552,"5Min":19_656 }[input.timeframe] ?? (() => {
    const intervals=bars.slice(1).map((bar,index) => Date.parse(bar.timestamp)-Date.parse(bars[index].timestamp)).sort((a,b) => a-b);
    const median=Math.max(1,intervals[Math.floor(intervals.length/2)] ?? 86_400_000);
    return median>=72_000_000?252:Math.min(105_120,Math.max(1,Math.round(365.25*86_400_000/median)));
  })();
  const volatility = stdev(returns) * Math.sqrt(annualPeriods);
  const winners = trades.filter((trade) => trade.pnl > 0);
  return {
    strategy: input.strategy,
    parameters: input.parameters ?? {},
    metrics: {
      initialCapital: round(initialCapital, 2), finalEquity: round(cash, 2), totalReturnPct: round(totalReturn * 100), annualizedReturnPct: round(annualized * 100),
      benchmarkReturnPct: round((benchmarkCash / initialCapital - 1) * 100), maxDrawdownPct: round(maxDrawdown * 100),
      sharpeRatio: volatility ? round(average(returns) * annualPeriods / volatility) : 0, volatilityPct: round(volatility * 100),
      tradeCount: trades.length, winRatePct: trades.length ? round(winners.length / trades.length * 100) : 0,
      profitFactor: (() => { const gains=winners.reduce((sum,trade) => sum+trade.pnl,0);const losses=Math.abs(trades.filter((trade) => trade.pnl<0).reduce((sum,trade) => sum+trade.pnl,0));return losses?round(gains/losses):gains>0?999:0; })(),
      exposurePct: round(investedBars / bars.length * 100), totalCosts: round(fillCount * commission, 2),
    },
    data: { ...report, start: bars[0].timestamp, end: bars.at(-1).timestamp },
    equityCurve,
    trades,
  };
}
