import { getChatGPTUser } from "../../chatgpt-auth";
import { getUserCredentials } from "../../../db/user-credentials";

type SecFact = {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
  fy?: number;
  fp?: string;
  frame?: string;
};

type SecConcept = {
  label?: string;
  description?: string;
  units: Record<string, SecFact[]>;
};

type SecCompanyFacts = {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, SecConcept>>;
};

type TickerRecord = {
  cik_str: number;
  ticker: string;
  title: string;
};

type AnnualMetric = {
  end: string;
  value: number;
};

type RoeYear = {
  year: number;
  end: string;
  netIncome: number;
  averageEquity: number;
  roe: number;
};

const SEC_HEADERS = {
  "User-Agent": "Pulse AI research app research@chatgpt.com",
  "Accept-Encoding": "gzip, deflate",
  Accept: "application/json",
};

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const PERIODIC_FORMS = new Set([...ANNUAL_FORMS, "10-Q", "10-Q/A", "6-K", "6-K/A"]);
const HORIZONS = [1, 2, 3, 5, 10] as const;

function allFacts(concept?: SecConcept): SecFact[] {
  return concept ? Object.values(concept.units).flat() : [];
}

function conceptWithMostFacts(
  taxonomy: Record<string, SecConcept>,
  tags: string[],
  predicate: (fact: SecFact) => boolean,
): SecConcept | undefined {
  return tags
    .map((tag) => taxonomy[tag])
    .filter((concept): concept is SecConcept => Boolean(concept))
    .sort((a, b) => allFacts(b).filter(predicate).length - allFacts(a).filter(predicate).length)[0];
}

function durationDays(fact: SecFact): number {
  if (!fact.start) return 0;
  return (new Date(fact.end).getTime() - new Date(fact.start).getTime()) / 86_400_000;
}

function latestByEnd(facts: SecFact[]): SecFact[] {
  const byEnd = new Map<string, SecFact>();
  for (const fact of facts) {
    const existing = byEnd.get(fact.end);
    if (!existing || fact.filed > existing.filed) byEnd.set(fact.end, fact);
  }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
}

function annualFacts(concept?: SecConcept): SecFact[] {
  return latestByEnd(
    allFacts(concept).filter((fact) => {
      const days = durationDays(fact);
      return ANNUAL_FORMS.has(fact.form) && Number.isFinite(fact.val) && days >= 250 && days <= 450;
    }),
  );
}

function instantFacts(concept?: SecConcept): SecFact[] {
  return latestByEnd(
    allFacts(concept).filter(
      (fact) => PERIODIC_FORMS.has(fact.form) && Number.isFinite(fact.val) && (!fact.start || fact.start === fact.end),
    ),
  );
}

function closestFact(facts: SecFact[], target: string, toleranceDays = 50): SecFact | undefined {
  const targetTime = new Date(target).getTime();
  return facts
    .map((fact) => ({ fact, distance: Math.abs(new Date(fact.end).getTime() - targetTime) / 86_400_000 }))
    .filter((item) => item.distance <= toleranceDays)
    .sort((a, b) => a.distance - b.distance || b.fact.filed.localeCompare(a.fact.filed))[0]?.fact;
}

function valueAt(concept: SecConcept | undefined, date: string): number | null {
  const fact = closestFact(instantFacts(concept), date, 50);
  return fact ? fact.val : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function cagr(metrics: AnnualMetric[]): number | null {
  if (metrics.length < 2) return null;
  const newest = metrics[0];
  const oldest = metrics[metrics.length - 1];
  const years = Math.max(1, new Date(newest.end).getFullYear() - new Date(oldest.end).getFullYear());
  if (newest.value <= 0 || oldest.value <= 0) return null;
  return (Math.pow(newest.value / oldest.value, 1 / years) - 1) * 100;
}

function round(value: number | null, places = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function firstValueAt(
  taxonomy: Record<string, SecConcept>,
  tags: string[],
  date: string,
): { value: number; tag: string } | null {
  for (const tag of tags) {
    const value = valueAt(taxonomy[tag], date);
    if (value !== null) return { value, tag };
  }
  return null;
}

function annualSeries(taxonomy: Record<string, SecConcept>, tags: string[], limit = 10): AnnualMetric[] {
  const concept = conceptWithMostFacts(
    taxonomy,
    tags,
    (fact) => ANNUAL_FORMS.has(fact.form) && durationDays(fact) >= 250 && durationDays(fact) <= 450,
  );
  return annualFacts(concept).slice(0, limit).map((fact) => ({ end: fact.end, value: fact.val }));
}

function valueFromTagsAt(taxonomy: Record<string, SecConcept>, tags: string[], date: string): number | null {
  return firstValueAt(taxonomy, tags, date)?.value ?? null;
}

type ForecastInput = {
  revenue: number;
  nopat: number;
  growth: number;
  roic: number;
  wacc: number;
  terminalGrowth: number;
  terminalRoic: number;
  forecastYears?: number;
};

function buildEnterpriseForecast(input: ForecastInput) {
  const forecastYears = input.forecastYears ?? 10;
  let revenue = input.revenue;
  let nopat = input.nopat;
  let presentValue = 0;
  let economicProfitPresentValue = 0;
  let previousInvestedCapital = input.nopat / Math.max(0.01, input.roic);
  const rows = [];
  for (let year = 1; year <= forecastYears; year += 1) {
    const fade = year / forecastYears;
    const growth = input.growth + (input.terminalGrowth - input.growth) * fade;
    const roic = input.roic + (input.terminalRoic - input.roic) * fade;
    revenue *= 1 + growth;
    nopat *= 1 + growth;
    const investedCapital = nopat / Math.max(0.01, roic);
    const reinvestment = investedCapital - previousInvestedCapital;
    const reinvestmentRate = reinvestment / Math.max(1, nopat);
    const freeCashFlow = nopat - reinvestment;
    const discountFactor = 1 / ((1 + input.wacc) ** year);
    const presentValueOfFcf = freeCashFlow * discountFactor;
    const economicProfit = nopat - investedCapital * input.wacc;
    presentValue += presentValueOfFcf;
    economicProfitPresentValue += economicProfit * discountFactor;
    rows.push({ year, revenue, growth, nopat, roic, reinvestmentRate, freeCashFlow, discountFactor, presentValueOfFcf, investedCapital, economicProfit });
    previousInvestedCapital = investedCapital;
  }
  const nextNopat = nopat * (1 + input.terminalGrowth);
  const terminalReinvestment = clamp(input.terminalGrowth / Math.max(0.01, input.terminalRoic), 0, 0.8);
  const continuingValue = nextNopat * (1 - terminalReinvestment) / Math.max(0.01, input.wacc - input.terminalGrowth);
  const continuingValuePresentValue = continuingValue / ((1 + input.wacc) ** forecastYears);
  const terminalInvestedCapital = nextNopat / Math.max(0.01, input.terminalRoic);
  const terminalEconomicProfit = nextNopat - terminalInvestedCapital * input.wacc;
  const terminalEconomicProfitValue = terminalEconomicProfit / Math.max(0.01, input.wacc - input.terminalGrowth);
  const economicProfitValue = input.nopat / Math.max(0.01, input.roic)
    + economicProfitPresentValue
    + terminalEconomicProfitValue / ((1 + input.wacc) ** forecastYears);
  return {
    enterpriseValue: presentValue + continuingValuePresentValue,
    forecast: rows,
    continuingValue,
    continuingValuePresentValue,
    continuingValueShare: (presentValue + continuingValuePresentValue) > 0
      ? continuingValuePresentValue / (presentValue + continuingValuePresentValue)
      : null,
    explicitPeriodPresentValue: presentValue,
    economicProfitValue,
  };
}

function projectedEnterpriseValue(input: Omit<ForecastInput, "revenue"> & { revenue?: number }) {
  return buildEnterpriseForecast({ ...input, revenue: input.revenue ?? input.nopat }).enterpriseValue;
}

function qualityScore(
  roe5: number | null,
  positiveYears: number,
  availableYears: number,
  earningsCagr: number | null,
  debtToEquity: number | null,
  negativeEquity: boolean,
): number {
  const roePoints = roe5 === null ? 8 : roe5 >= 20 ? 35 : roe5 >= 15 ? 30 : roe5 >= 10 ? 24 : roe5 > 0 ? 14 : 0;
  const consistencyPoints = availableYears ? (positiveYears / availableYears) * 25 : 0;
  const growthPoints = earningsCagr === null ? 6 : earningsCagr >= 10 ? 20 : earningsCagr >= 5 ? 15 : earningsCagr > 0 ? 10 : 0;
  const leveragePoints = negativeEquity ? 0 : debtToEquity === null ? 8 : debtToEquity <= 0.5 ? 20 : debtToEquity <= 1 ? 16 : debtToEquity <= 2 ? 10 : 0;
  return Math.round(roePoints + consistencyPoints + growthPoints + leveragePoints);
}

export function analyzeCompany(symbol: string, cik: number, facts: SecCompanyFacts, marketPrice: number | null = null) {
  const taxonomyName = facts.facts["us-gaap"] ? "us-gaap" : facts.facts["ifrs-full"] ? "ifrs-full" : null;
  if (!taxonomyName) throw new Error("No standardized financial statement data is available.");
  const taxonomy = facts.facts[taxonomyName];
  const annualPredicate = (fact: SecFact) => ANNUAL_FORMS.has(fact.form) && durationDays(fact) >= 250 && durationDays(fact) <= 450;

  const netIncomeConcept = conceptWithMostFacts(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]
      : ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
    annualPredicate,
  );
  const equityConcept = conceptWithMostFacts(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "PartnersCapital"]
      : ["EquityAttributableToOwnersOfParent", "Equity"],
    (fact) => PERIODIC_FORMS.has(fact.form) && (!fact.start || fact.start === fact.end),
  );

  const incomeFacts = annualFacts(netIncomeConcept).slice(0, 12);
  const equityFacts = instantFacts(equityConcept);
  if (!incomeFacts.length || !equityFacts.length) throw new Error("Not enough annual income and equity data was reported.");

  const roeYears: RoeYear[] = incomeFacts
    .map((income) => {
      const endingEquity = closestFact(equityFacts, income.end);
      const beginningEquity = income.start ? closestFact(equityFacts, income.start) : undefined;
      if (!endingEquity || !beginningEquity) return null;
      const averageEquity = (endingEquity.val + beginningEquity.val) / 2;
      if (averageEquity <= 0) return null;
      return {
        year: new Date(income.end).getFullYear(),
        end: income.end,
        netIncome: income.val,
        averageEquity,
        roe: (income.val / averageEquity) * 100,
      };
    })
    .filter((year): year is RoeYear => Boolean(year))
    .slice(0, 10);

  if (!roeYears.length) throw new Error("Reported equity was non-positive or insufficient for ROE calculation.");

  const horizons = Object.fromEntries(
    HORIZONS.map((horizon) => {
      const values = roeYears.slice(0, horizon).map((year) => year.roe);
      return [`${horizon}y`, { value: round(average(values)), yearsUsed: values.length }];
    }),
  );

  const latestEnd = incomeFacts[0].end;
  const latestEquity = closestFact(equityFacts, latestEnd)?.val ?? equityFacts[0]?.val ?? null;
  const directDebt = firstValueAt(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities", "DebtLongtermAndShorttermCombinedAmount"]
      : ["Borrowings", "LoansAndBorrowings"],
    latestEnd,
  );
  const currentDebt = firstValueAt(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["DebtCurrent", "ShortTermDebtCurrent", "ShortTermBorrowings", "OtherShortTermBorrowings", "LongTermDebtAndFinanceLeaseObligationsCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "LongTermDebtCurrent"]
      : ["BorrowingsCurrent", "CurrentBorrowings"],
    latestEnd,
  );
  const noncurrentDebt = firstValueAt(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"]
      : ["BorrowingsNoncurrent", "NoncurrentBorrowings"],
    latestEnd,
  );
  const totalDebt = directDebt?.value ?? (currentDebt || noncurrentDebt ? (currentDebt?.value ?? 0) + (noncurrentDebt?.value ?? 0) : null);
  const negativeEquity = latestEquity !== null && latestEquity <= 0;
  const debtToEquity = totalDebt !== null && latestEquity !== null && latestEquity > 0 ? totalDebt / latestEquity : null;
  const highDebtFlag = negativeEquity || (debtToEquity !== null && debtToEquity > 2);

  const netIncomeSeries = incomeFacts.slice(0, 10).map((fact) => ({ end: fact.end, value: fact.val }));
  const earningsGrowth = cagr(netIncomeSeries);
  const dividendConcept = conceptWithMostFacts(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "CommonStockDividendsPerShareDeclared"]
      : ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid"],
    annualPredicate,
  );
  const dividendSeries = annualFacts(dividendConcept)
    .slice(0, 10)
    .map((fact) => ({ end: fact.end, value: Math.abs(fact.val) }));
  const dividendGrowth = cagr(dividendSeries);
  const positiveYears = roeYears.filter((year) => year.roe > 0).length;
  const roe5 = (horizons["5y"] as { value: number | null }).value;
  const rawScore = qualityScore(roe5, positiveYears, roeYears.length, earningsGrowth, debtToEquity, negativeEquity);
  const score = highDebtFlag ? Math.min(rawScore, 64) : rawScore;
  const verdict = score >= 80 ? "Durable compounder" : score >= 65 ? "Quality candidate" : score >= 50 ? "Mixed evidence" : "Needs caution";

  const revenueSeries = annualSeries(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet"]
      : ["Revenue"],
  );
  const operatingIncomeSeries = annualSeries(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["OperatingIncomeLoss", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"]
      : ["ProfitLossFromOperatingActivities", "ProfitLossBeforeTax"],
  );
  const pretaxSeries = annualSeries(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxes"]
      : ["ProfitLossBeforeTax"],
  );
  const taxSeries = annualSeries(
    taxonomy,
    taxonomyName === "us-gaap" ? ["IncomeTaxExpenseBenefit"] : ["IncomeTaxExpenseContinuingOperations", "IncomeTaxExpense"],
  );
  const latestRevenue = revenueSeries[0]?.value ?? null;
  const latestOperatingIncome = operatingIncomeSeries[0]?.value ?? null;
  const latestPretax = pretaxSeries.find((item) => item.end === operatingIncomeSeries[0]?.end)?.value ?? pretaxSeries[0]?.value ?? null;
  const latestTax = taxSeries.find((item) => item.end === operatingIncomeSeries[0]?.end)?.value ?? taxSeries[0]?.value ?? null;
  const cashTaxRate = latestPretax && latestPretax > 0 && latestTax !== null
    ? clamp(latestTax / latestPretax, 0, 0.35)
    : 0.21;
  const nopat = latestOperatingIncome !== null ? latestOperatingIncome * (1 - cashTaxRate) : null;
  const cash = valueFromTagsAt(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]
      : ["CashAndCashEquivalents"],
    latestEnd,
  );
  const investedCapital = latestEquity !== null && totalDebt !== null
    ? Math.max(0, latestEquity + totalDebt - Math.max(0, cash ?? 0))
    : null;
  const roic = nopat !== null && investedCapital && investedCapital > 0 ? nopat / investedCapital : null;
  const historicalRevenueGrowth = cagr(revenueSeries.slice(0, 6));
  const explicitGrowth = clamp((historicalRevenueGrowth ?? 4) / 100, -0.05, 0.15);
  const normalizedRoic = clamp(roic ?? 0.1, 0.03, 0.5);
  const deiTaxonomy = facts.facts.dei ?? {};
  const sharesOutstanding = valueFromTagsAt(
    { ...taxonomy, ...deiTaxonomy },
    ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding"],
    latestEnd,
  );
  const marketCapitalization = marketPrice && sharesOutstanding ? marketPrice * sharesOutstanding : null;
  const interestExpenseSeries = annualSeries(
    taxonomy,
    taxonomyName === "us-gaap"
      ? ["InterestExpenseNonOperating", "InterestAndDebtExpense", "InterestExpense"]
      : ["FinanceCosts", "InterestExpense"],
  );
  const latestInterestExpense = Math.abs(interestExpenseSeries[0]?.value ?? 0);
  const preTaxCostOfDebt = totalDebt && totalDebt > 0 && latestInterestExpense > 0
    ? clamp(latestInterestExpense / totalDebt, 0.03, 0.1)
    : 0.05;
  const costOfEquity = 0.0925;
  const debtWeight = totalDebt && totalDebt > 0
    ? clamp(totalDebt / (totalDebt + Math.max(1, marketCapitalization ?? Math.max(0, latestEquity ?? 0))), 0, 0.6)
    : 0;
  const equityWeight = 1 - debtWeight;
  const wacc = clamp(costOfEquity * equityWeight + preTaxCostOfDebt * (1 - cashTaxRate) * debtWeight, 0.07, 0.12);
  const terminalGrowth = 0.025;
  const terminalRoic = clamp(normalizedRoic * 0.65, 0.06, 0.18);
  const reinvestmentRate = clamp(explicitGrowth / normalizedRoic, -0.5, 0.9);
  const normalizedFreeCashFlow = nopat !== null ? nopat * (1 - reinvestmentRate) : null;
  const enterpriseForecast = nopat !== null && nopat > 0 && latestRevenue !== null && latestRevenue > 0
    ? buildEnterpriseForecast({ revenue:latestRevenue, nopat, growth:explicitGrowth, roic:normalizedRoic, wacc, terminalGrowth, terminalRoic })
    : null;
  const enterpriseValue = enterpriseForecast?.enterpriseValue ?? null;
  const netDebt = totalDebt !== null ? totalDebt - Math.max(0, cash ?? 0) : null;
  const equityValue = enterpriseValue !== null && netDebt !== null ? Math.max(0, enterpriseValue - netDebt) : null;
  const fairValuePerShare = equityValue !== null && sharesOutstanding && sharesOutstanding > 0 ? equityValue / sharesOutstanding : null;
  const valuationGap = fairValuePerShare !== null && marketPrice && marketPrice > 0 ? (fairValuePerShare / marketPrice - 1) * 100 : null;
  const economicProfit = investedCapital !== null && roic !== null ? investedCapital * (roic - wacc) : null;
  const valuationSignal = valuationGap === null
    ? "Intrinsic value estimate"
    : valuationGap >= 20 ? "Below modeled value"
    : valuationGap <= -20 ? "Above modeled value"
    : "Near modeled value";
  const scenarioInputs = [
    { name:"Cautious", growth:clamp(explicitGrowth - 0.03, -0.08, 0.12), discountRate:0.1 },
    { name:"Base", growth:explicitGrowth, discountRate:wacc },
    { name:"Optimistic", growth:clamp(explicitGrowth + 0.03, -0.02, 0.18), discountRate:0.08 },
  ];
  const scenarios = nopat !== null && nopat > 0 && sharesOutstanding && sharesOutstanding > 0 && netDebt !== null
    ? scenarioInputs.map((scenario) => {
      const scenarioEnterpriseValue = projectedEnterpriseValue({
        revenue:latestRevenue ?? nopat,
        nopat,
        growth:scenario.growth,
        roic:normalizedRoic,
        wacc:scenario.discountRate,
        terminalGrowth,
        terminalRoic,
      });
      return {
        name:scenario.name,
        growth:round(scenario.growth * 100),
        discountRate:round(scenario.discountRate * 100),
        perShare:round(Math.max(0, scenarioEnterpriseValue - netDebt) / sharesOutstanding, 2),
      };
    })
    : [];
  const sensitivityGrowthRates = [terminalGrowth - 0.005, terminalGrowth, terminalGrowth + 0.005];
  const sensitivityDiscountRates = [wacc - 0.01, wacc, wacc + 0.01];
  const sensitivity = nopat !== null && nopat > 0 && latestRevenue !== null && sharesOutstanding && sharesOutstanding > 0 && netDebt !== null
    ? sensitivityGrowthRates.map((growth) => ({
      terminalGrowth:round(growth * 100),
      values:sensitivityDiscountRates.map((discountRate) => ({
        discountRate:round(discountRate * 100),
        perShare:round(Math.max(0, projectedEnterpriseValue({
          revenue:latestRevenue,
          nopat,
          growth:explicitGrowth,
          roic:normalizedRoic,
          wacc:discountRate,
          terminalGrowth:growth,
          terminalRoic,
        }) - netDebt) / sharesOutstanding, 2),
      })),
    }))
    : [];
  const marketEnterpriseValue = marketCapitalization !== null && netDebt !== null ? marketCapitalization + netDebt : null;
  const modeledEvToNopat = enterpriseValue !== null && nopat && nopat > 0 ? enterpriseValue / nopat : null;
  const marketEvToNopat = marketEnterpriseValue !== null && nopat && nopat > 0 ? marketEnterpriseValue / nopat : null;
  const modeledEvToOperatingProfit = enterpriseValue !== null && latestOperatingIncome && latestOperatingIncome > 0 ? enterpriseValue / latestOperatingIncome : null;
  const marketEvToOperatingProfit = marketEnterpriseValue !== null && latestOperatingIncome && latestOperatingIncome > 0 ? marketEnterpriseValue / latestOperatingIncome : null;
  const downsideValue = scenarios[0]?.perShare ?? null;
  const upsideValue = scenarios[2]?.perShare ?? null;
  const roicSpread = roic === null ? null : roic - wacc;
  const conclusion = (() => {
    if (marketPrice === null || fairValuePerShare === null || valuationGap === null) return {
      rating:"PRICE NEEDED",
      action:"Complete the market-price comparison before considering a purchase.",
      tone:"neutral",
      summary:`The operating model estimates intrinsic value near ${fairValuePerShare === null ? "an unavailable amount" : `$${round(fairValuePerShare, 2)}`} per share, but no recent market price was available. Valuation becomes an investment decision only when value is compared with the price you must pay.`,
      reasons:["Review the current share price and rerun with a connected Alpaca market-data profile.", roicSpread !== null && roicSpread > 0 ? "The company currently earns more on operating capital than the modeled cost of capital." : "The value-creation spread is weak or unavailable and deserves extra scrutiny."],
    };
    if (valuationGap >= 25 && (downsideValue === null || downsideValue >= marketPrice * 0.85) && (roicSpread ?? 0) > 0) return {
      rating:"ATTRACTIVE",
      action:"Potential buy candidate - verify the assumptions and business risks before sizing a position.",
      tone:"positive",
      summary:`The base case is ${round(valuationGap)}% above the market price, while the company is earning a positive return spread over its cost of capital. That combination suggests a meaningful modeled margin of safety.`,
      reasons:[`Modeled value is about $${round(fairValuePerShare, 2)} versus a recent price of $${round(marketPrice, 2)}.`, `The cautious-to-optimistic range is roughly $${round(downsideValue, 2)} to $${round(upsideValue, 2)} per share.`, "A purchase still depends on whether the forecast, competitive advantage, and accounting adjustments survive due diligence."],
    };
    if (valuationGap >= 10 && (roicSpread ?? 0) > 0) return {
      rating:"WATCH / CONSIDER",
      action:"Consider only with a patient horizon and a margin-of-safety discipline.",
      tone:"positive",
      summary:`The base case is ${round(valuationGap)}% above the recent market price and operating returns exceed the modeled hurdle rate, but the valuation cushion is not large enough to make the conclusion robust to modest forecast errors.`,
      reasons:[`Modeled value is about $${round(fairValuePerShare, 2)} per share.`, `The scenario range spans approximately $${round(downsideValue, 2)} to $${round(upsideValue, 2)}.`, "Waiting for a better entry price can improve the protection against model error."],
    };
    if (valuationGap <= -20) return {
      rating:"EXPENSIVE",
      action:"Avoid a new purchase unless you can justify materially stronger economics than the base case.",
      tone:"negative",
      summary:`The recent market price is about ${round(Math.abs(valuationGap))}% above the base-case intrinsic value estimate. The current quote appears to demand better growth, returns, or durability than this filing-based model supports.`,
      reasons:[`Modeled value is about $${round(fairValuePerShare, 2)} versus a recent price of $${round(marketPrice, 2)}.`, "Paying above modeled value reduces the margin for forecasting error.", "A superior qualitative thesis may justify the premium, but it should be explicit and testable."],
    };
    return {
      rating:"NEAR FAIR VALUE",
      action:"Hold or wait for a clearer margin of safety rather than treating the estimate as a precise target.",
      tone:"neutral",
      summary:`The recent price sits within roughly ${round(Math.abs(valuationGap))}% of the base-case estimate, so the stock appears broadly priced for the operating assumptions already in the model.`,
      reasons:[`Modeled value is about $${round(fairValuePerShare, 2)} per share.`, `The scenario range of about $${round(downsideValue, 2)} to $${round(upsideValue, 2)} shows how quickly the answer changes with growth and risk.`, "A better purchase case would require either a lower price or stronger evidence for above-base performance."],
    };
  })();

  const strengths: string[] = [];
  const cautions: string[] = [];
  if (roe5 !== null && roe5 >= 15) strengths.push(`Five-year average ROE of ${round(roe5)}% shows strong use of shareholder capital.`);
  if (positiveYears === roeYears.length && roeYears.length >= 5) strengths.push(`ROE stayed positive in all ${roeYears.length} measured years.`);
  if (earningsGrowth !== null && earningsGrowth > 5) strengths.push(`Reported net income compounded at about ${round(earningsGrowth)}% annually across the available decade.`);
  if (dividendGrowth !== null && dividendGrowth > 0) strengths.push(`Reported dividends grew about ${round(dividendGrowth)}% annually across the available period.`);
  if (debtToEquity !== null && debtToEquity <= 1) strengths.push(`Debt-to-equity of ${round(debtToEquity, 2)}x leaves a comparatively conservative capital structure.`);
  if (highDebtFlag) cautions.push(negativeEquity ? "RED FLAG: Reported shareholder equity is non-positive." : `RED FLAG: Debt-to-equity is ${round(debtToEquity, 2)}x, above the 2.0x screen.`);
  if (roeYears.some((year) => Math.abs(year.roe) > 200)) cautions.push("Very thin shareholder equity magnifies ROE, so the headline percentage is less reliable as a quality signal.");
  if (roe5 !== null && roe5 < 10) cautions.push(`Five-year average ROE of ${round(roe5)}% is below the screen's quality range.`);
  if (earningsGrowth !== null && earningsGrowth <= 0) cautions.push("Reported net income did not compound positively across the available long period.");
  if (roeYears.length < 10) cautions.push(`Only ${roeYears.length} comparable annual ROE observations were available.`);
  if (!strengths.length) strengths.push("The filing history provides enough standardized data for a multi-period review.");
  if (!cautions.length) cautions.push("No mechanical red flag triggered; valuation, competition, and management still require separate review.");

  return {
    symbol,
    companyName: facts.entityName,
    cik: String(cik).padStart(10, "0"),
    asOf: latestEnd,
    score,
    verdict,
    roe: horizons,
    annualRoe: roeYears.map((year) => ({ year: year.year, value: round(year.roe) })),
    debtToEquity: round(debtToEquity, 2),
    totalDebt,
    shareholderEquity: latestEquity,
    highDebtFlag,
    negativeEquity,
    earningsCagr: round(earningsGrowth),
    dividendCagr: round(dividendGrowth),
    positiveRoeYears: positiveYears,
    yearsAnalyzed: roeYears.length,
    strengths,
    cautions,
    valuation: nopat !== null && latestRevenue !== null && investedCapital !== null ? {
      framework:"McKinsey-style enterprise DCF",
      revenue:latestRevenue,
      revenueGrowth:round(explicitGrowth * 100),
      operatingIncome:latestOperatingIncome,
      cashTaxRate:round(cashTaxRate * 100),
      nopat,
      nopatMargin:round((nopat / latestRevenue) * 100),
      investedCapital,
      roic:round(roic === null ? null : roic * 100),
      wacc:round(wacc * 100),
      roicSpread:round(roic === null ? null : (roic - wacc) * 100),
      economicProfit,
      reinvestmentRate:round(reinvestmentRate * 100),
      normalizedFreeCashFlow,
      terminalGrowth:round(terminalGrowth * 100),
      terminalRoic:round(terminalRoic * 100),
      forecastYears:enterpriseForecast?.forecast.length ?? 0,
      forecast:enterpriseForecast?.forecast.map((row) => ({
        year:row.year,
        revenue:row.revenue,
        growth:round(row.growth * 100),
        nopat:row.nopat,
        roic:round(row.roic * 100),
        reinvestmentRate:round(row.reinvestmentRate * 100),
        freeCashFlow:row.freeCashFlow,
        presentValue:row.presentValueOfFcf,
        economicProfit:row.economicProfit,
      })) ?? [],
      explicitPeriodPresentValue:enterpriseForecast?.explicitPeriodPresentValue ?? null,
      continuingValue:enterpriseForecast?.continuingValue ?? null,
      continuingValuePresentValue:enterpriseForecast?.continuingValuePresentValue ?? null,
      continuingValueShare:round(enterpriseForecast?.continuingValueShare === null || enterpriseForecast?.continuingValueShare === undefined ? null : enterpriseForecast.continuingValueShare * 100),
      enterpriseValue,
      economicProfitValue:enterpriseForecast?.economicProfitValue ?? null,
      economicProfitCrossCheckDifference:enterpriseValue !== null && enterpriseForecast
        ? round((enterpriseForecast.economicProfitValue / enterpriseValue - 1) * 100)
        : null,
      cash,
      netDebt,
      equityValue,
      sharesOutstanding,
      marketCapitalization,
      fairValuePerShare:round(fairValuePerShare, 2),
      marketPrice:round(marketPrice, 2),
      valuationGap:round(valuationGap),
      signal:valuationSignal,
      scenarios,
      sensitivity:{
        discountRates:sensitivityDiscountRates.map((rate) => round(rate * 100)),
        rows:sensitivity,
      },
      waccBridge:{
        costOfEquity:round(costOfEquity * 100),
        preTaxCostOfDebt:round(preTaxCostOfDebt * 100),
        afterTaxCostOfDebt:round(preTaxCostOfDebt * (1 - cashTaxRate) * 100),
        equityWeight:round(equityWeight * 100),
        debtWeight:round(debtWeight * 100),
        wacc:round(wacc * 100),
      },
      multiples:{
        modeledEvToNopat:round(modeledEvToNopat, 1),
        marketEvToNopat:round(marketEvToNopat, 1),
        modeledEvToOperatingProfit:round(modeledEvToOperatingProfit, 1),
        marketEvToOperatingProfit:round(marketEvToOperatingProfit, 1),
      },
      conclusion,
      process:[
        "Reorganize reported statements around operations: revenue, NOPAT, invested capital, and free cash flow.",
        "Diagnose historical growth, return on invested capital, and financial health before forecasting.",
        "Forecast revenue, NOPAT, reinvestment, ROIC, and free cash flow year by year until the company approaches a mature state.",
        "Discount enterprise free cash flow at the weighted average cost of capital and estimate continuing value with a value-driver formula.",
        "Cross-check operating value with discounted economic profit and market-implied operating multiples.",
        "Add nonoperating cash, subtract debt and other senior claims, and divide the residual equity value by shares outstanding.",
        "Test scenarios and sensitivities, then compare the valuation range with the current price before drawing an investment conclusion.",
      ],
      coverage:[
        { item:"Core operations", status:"included", detail:"Revenue, operating profit, operating taxes, NOPAT, invested capital, ROIC, reinvestment, and enterprise free cash flow." },
        { item:"Continuing value", status:"included", detail:"Value-driver perpetuity with mature growth and return on new capital." },
        { item:"Capital cost", status:"estimated", detail:"Blended cost of equity and after-tax debt using a filing- and market-cap-based capital structure. Beta and peer inputs remain normalized." },
        { item:"Enterprise-to-equity bridge", status:"included", detail:"Cash and reported borrowings are reflected; shares use the latest standardized filing fact available." },
        { item:"Advanced adjustments", status:"review", detail:"Leases, pensions, options, minority interests, provisions, tax assets, cross-holdings, and segment-specific forecasts require filing-note review." },
        { item:"Special situations", status:"review", detail:"Banks, insurers, cyclical, high-growth, emerging-market, and multibusiness companies may require a sector-specific or sum-of-parts model." },
      ],
      assumptions:[
        "Ten explicit forecast years begin with the company’s available revenue history, capped between −5% and 15%, then fade toward mature growth so the continuing period begins in a steadier state.",
        "The discount rate blends a normalized 9.25% cost of equity with filing-based debt cost and capital-structure weights, then the sensitivity table moves that rate by one percentage point in either direction.",
        "Long-run growth is 2.5%, while return on new capital fades toward a more mature level instead of assuming today’s advantages last unchanged forever.",
        "The model uses standardized SEC facts and does not silently invent unavailable adjustments. Items that require footnote or peer research are labeled for review in the coverage audit.",
        "This educational model implements the book’s core enterprise DCF workflow, but professional valuation still requires judgment about competition, management, accounting normalization, and sector economics.",
      ],
    } : null,
    sourceUrl: `https://www.sec.gov/edgar/browse/?CIK=${String(cik).padStart(10, "0")}`,
    methodology: {
      roe: "Annual net income divided by average beginning and ending shareholder equity; horizon figures are averages of annual ROE.",
      debt: "Current plus noncurrent reported borrowings divided by shareholder equity. A red flag triggers above 2.0x or when equity is non-positive.",
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: SEC_HEADERS });
  if (!response.ok) throw new Error(`SEC data request failed (${response.status}).`);
  return (await response.json()) as T;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { symbols?: unknown };
  const symbols = Array.from(
    new Set(
      String(body.symbols ?? "")
        .toUpperCase()
        .split(/[\s,;]+/)
        .map((symbol) => symbol.trim().replace(/[^A-Z0-9.-]/g, ""))
        .filter(Boolean),
    ),
  ).slice(0, 12);
  if (!symbols.length) return Response.json({ error: "Enter at least one stock symbol." }, { status: 400 });

  try {
    const tickerMap = await fetchJson<Record<string, TickerRecord>>("https://www.sec.gov/files/company_tickers.json");
    const byTicker = new Map(Object.values(tickerMap).map((record) => [record.ticker.toUpperCase(), record]));
    const credentials = await getUserCredentials(user.email).catch(() => null);
    const prices = new Map<string, number>();
    if (credentials) {
      const priceResponse = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=iex`, {
        headers:{ "APCA-API-KEY-ID":credentials.keyId, "APCA-API-SECRET-KEY":credentials.secretKey },
      }).catch(() => null);
      if (priceResponse?.ok) {
        type PriceSnapshot = { latestTrade?:{ p:number };dailyBar?:{ c:number } };
        const payload = await priceResponse.json() as { snapshots?:Record<string,PriceSnapshot> } & Record<string,unknown>;
        const snapshots = payload.snapshots ?? payload as Record<string,PriceSnapshot>;
        for (const symbol of symbols) {
          const price = snapshots[symbol]?.latestTrade?.p ?? snapshots[symbol]?.dailyBar?.c;
          if (price && Number.isFinite(price)) prices.set(symbol, price);
        }
      }
    }
    const results = [];

    for (const symbol of symbols) {
      const record = byTicker.get(symbol);
      if (!record) {
        results.push({ symbol, error: "Symbol was not found in the SEC company ticker directory." });
        continue;
      }
      try {
        const cik = String(record.cik_str).padStart(10, "0");
        const facts = await fetchJson<SecCompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
        results.push(analyzeCompany(symbol, record.cik_str, facts, prices.get(symbol) ?? null));
      } catch (error) {
        results.push({ symbol, companyName: record.title, error: error instanceof Error ? error.message : "Analysis unavailable." });
      }
    }

    return Response.json({
      analyzedAt: new Date().toISOString(),
      results,
      framework: "Berkshire quality screen plus McKinsey-style enterprise DCF",
      sourceNote: "Standardized company facts reported to the U.S. SEC. Filing availability and taxonomy choices vary by issuer.",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Company analysis is temporarily unavailable." },
      { status: 502 },
    );
  }
}
