import { getChatGPTUser } from "../../chatgpt-auth";
import { getUserCredentials } from "../../../db/user-credentials";

type CompanyRecord = { cik_str:number; ticker:string; title:string };
type NewsStory = {
  id:number;
  headline:string;
  summary?:string;
  source:string;
  created_at:string;
  updated_at?:string;
  url?:string;
  symbols?:string[];
};

type ProductProfile = {
  company:string;
  product:string;
  direction:string;
  category:string;
  peers:string[];
  keywords:string[];
};

const PROFILES: Record<string, ProductProfile> = {
  NVDA:{ company:"NVIDIA",product:"Blackwell AI systems",direction:"Owning the full AI-compute stack, from accelerated silicon to networking and software",category:"AI infrastructure",peers:["AMD","AVGO","INTC"],keywords:["blackwell","gpu","ai chip","cuda","data center"] },
  AMD:{ company:"AMD",product:"Instinct accelerators",direction:"Breaking into hyperscale AI compute with an open, high-performance accelerator platform",category:"AI infrastructure",peers:["NVDA","INTC","AVGO"],keywords:["instinct","mi300","mi350","accelerator","gpu","ai chip"] },
  MSFT:{ company:"Microsoft",product:"Copilot + Azure AI",direction:"Turning AI into a platform layer across cloud, work, development, and security",category:"enterprise AI platforms",peers:["GOOGL","AMZN","ORCL"],keywords:["copilot","azure ai","foundry","openai","agent"] },
  GOOGL:{ company:"Alphabet",product:"Gemini",direction:"Embedding multimodal AI across search, cloud, Android, and productivity",category:"consumer and cloud AI",peers:["MSFT","AMZN","META"],keywords:["gemini","deepmind","vertex ai","ai overview","search"] },
  AMZN:{ company:"Amazon",product:"AWS Bedrock",direction:"Making AWS the neutral infrastructure and model marketplace for enterprise AI",category:"enterprise AI platforms",peers:["MSFT","GOOGL","ORCL"],keywords:["bedrock","aws","trainium","anthropic","agent"] },
  META:{ company:"Meta",product:"Llama + Meta AI",direction:"Using open models and AI assistants to strengthen engagement, advertising, and smart devices",category:"consumer AI assistants",peers:["GOOGL","MSFT","AAPL"],keywords:["llama","meta ai","ray-ban","assistant","model"] },
  AAPL:{ company:"Apple",product:"Apple Intelligence",direction:"Making private, on-device AI the next layer of the Apple ecosystem",category:"consumer AI assistants",peers:["GOOGL","MSFT","META"],keywords:["apple intelligence","siri","on-device","iphone","private cloud"] },
  TSLA:{ company:"Tesla",product:"Full Self-Driving + Robotaxi",direction:"Expanding from electric vehicles into autonomous mobility and embodied AI",category:"autonomous mobility",peers:["GOOGL","UBER","GM"],keywords:["robotaxi","full self-driving","fsd","autonomous","cybercab"] },
  PLTR:{ company:"Palantir",product:"Artificial Intelligence Platform (AIP)",direction:"Operationalizing AI inside governments and large enterprises",category:"enterprise AI software",peers:["MSFT","ORCL","CRM"],keywords:["aip","artificial intelligence platform","bootcamp","ontology","government"] },
  CRM:{ company:"Salesforce",product:"Agentforce",direction:"Moving CRM from systems of record toward autonomous digital labor",category:"enterprise AI agents",peers:["MSFT","NOW","ORCL"],keywords:["agentforce","einstein","data cloud","agent","slack"] },
  NOW:{ company:"ServiceNow",product:"Now Assist + AI agents",direction:"Automating enterprise workflows with domain-specific AI agents",category:"enterprise AI agents",peers:["CRM","MSFT","ORCL"],keywords:["now assist","ai agent","workflow","automation","agentic"] },
  ORCL:{ company:"Oracle",product:"Oracle Cloud Infrastructure AI",direction:"Pairing database gravity with high-performance cloud infrastructure for enterprise AI",category:"enterprise AI platforms",peers:["MSFT","AMZN","GOOGL"],keywords:["oci","cloud infrastructure","database","ai cluster","gpu"] },
  AVGO:{ company:"Broadcom",product:"Custom AI accelerators + networking",direction:"Becoming the essential connectivity and custom-silicon layer behind hyperscale AI",category:"AI infrastructure",peers:["NVDA","AMD","MRVL"],keywords:["custom accelerator","xpu","ethernet","networking","ai chip"] },
  INTC:{ company:"Intel",product:"Gaudi accelerators + foundry",direction:"Rebuilding competitiveness through open AI compute and advanced manufacturing",category:"AI infrastructure",peers:["NVDA","AMD","TSM"],keywords:["gaudi","foundry","accelerator","xeon","process node"] },
  SNOW:{ company:"Snowflake",product:"Cortex AI",direction:"Bringing governed AI directly to enterprise data",category:"enterprise data AI",peers:["DDOG","ORCL","MSFT"],keywords:["cortex","snowflake intelligence","data cloud","ai agent","arctic"] },
  DDOG:{ company:"Datadog",product:"AI-powered observability",direction:"Becoming the control plane for complex cloud and AI workloads",category:"AI observability",peers:["NOW","CRWD","SNOW"],keywords:["observability","llm observability","cloud security","ai workload","bits ai"] },
  CRWD:{ company:"CrowdStrike",product:"Falcon + Charlotte AI",direction:"Consolidating cybersecurity around an AI-native security operations platform",category:"AI cybersecurity",peers:["PANW","MSFT","DDOG"],keywords:["falcon","charlotte ai","endpoint","security operations","cloud security"] },
  PANW:{ company:"Palo Alto Networks",product:"Precision AI",direction:"Consolidating network, cloud, and security operations on an AI-led platform",category:"AI cybersecurity",peers:["CRWD","MSFT","ZS"],keywords:["precision ai","cortex","prisma","platformization","security operations"] },
  UBER:{ company:"Uber",product:"Autonomous mobility marketplace",direction:"Positioning its network as the demand layer for human-driven and autonomous transportation",category:"autonomous mobility",peers:["TSLA","GOOGL","LYFT"],keywords:["autonomous","robotaxi","waymo","mobility","delivery"] },
  COIN:{ company:"Coinbase",product:"Base",direction:"Expanding from crypto brokerage into the application and payments layer of the onchain economy",category:"crypto platforms",peers:["HOOD","PYPL","SQ"],keywords:["base","stablecoin","usdc","onchain","payments"] },
  SHOP:{ company:"Shopify",product:"Sidekick + Shop Pay",direction:"Building an AI commerce operating system for independent merchants",category:"AI commerce",peers:["AMZN","WMT","CRM"],keywords:["sidekick","shop pay","merchant","commerce","ai assistant"] },
  ADBE:{ company:"Adobe",product:"Firefly",direction:"Making commercially safe generative AI native to creative and marketing workflows",category:"creative AI",peers:["META","GOOGL","CRM"],keywords:["firefly","creative cloud","generative ai","content credentials","express"] },
  NFLX:{ company:"Netflix",product:"Ad-supported streaming platform",direction:"Broadening growth beyond subscriptions through advertising, live programming, and games",category:"streaming platforms",peers:["DIS","AMZN","WBD"],keywords:["advertising","ad tier","live","games","streaming"] },
  V:{ company:"Visa",product:"Visa Intelligent Commerce",direction:"Turning its payments network into an AI-enabled commerce and identity layer",category:"AI payments",peers:["MA","PYPL","AXP"],keywords:["intelligent commerce","token","credential","agentic commerce","payments"] },
};

const POSITIVE = ["accelerat","adoption","award","beat","breakthrough","expand","gain","growth","higher","launch","lead","partner","record","strong","surge","upgrade","win"];
const NEGATIVE = ["antitrust","breach","cut","delay","downgrade","fall","investigation","lawsuit","layoff","loss","miss","probe","recall","risk","slump","weak"];
const MOMENTUM = ["launch","unveil","introduc","partner","contract","expand","deploy","adopt","invest","order","customer","approval"];

function clamp(value:number,min=0,max=100) { return Math.max(min,Math.min(max,value)); }
function normalize(value:string) { return value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }

function storyScore(story:NewsStory,keywords:string[]) {
  const text = `${story.headline} ${story.summary ?? ""}`.toLowerCase();
  const positive = POSITIVE.filter((term) => text.includes(term));
  const negative = NEGATIVE.filter((term) => text.includes(term));
  const momentum = MOMENTUM.filter((term) => text.includes(term));
  const productHits = keywords.filter((term) => text.includes(term.toLowerCase()));
  const tone = clamp(50 + positive.length * 9 - negative.length * 11,0,100);
  return { tone,positive,negative,momentum,productHits };
}

async function companyDirectory() {
  const response = await fetch("https://www.sec.gov/files/company_tickers.json",{ headers:{ "user-agent":"Pulse AI research contact@pulse-ai.local" } });
  if (!response.ok) throw new Error("Company directory is temporarily unavailable.");
  const payload = await response.json() as Record<string,CompanyRecord>;
  return Object.values(payload);
}

function resolveCompany(query:string,directory:CompanyRecord[]) {
  const raw = query.trim();
  const symbol = raw.toUpperCase().replace(/[^A-Z.\-]/g,"");
  const byTicker = directory.find((item) => item.ticker.toUpperCase() === symbol);
  if (byTicker) return byTicker;
  const target = normalize(raw).replace(/\b(inc|incorporated|corp|corporation|company|co|plc|holdings?)\b/g,"").trim();
  const exact = directory.find((item) => normalize(item.title).replace(/\b(inc|incorporated|corp|corporation|company|co|plc|holdings?)\b/g,"").trim() === target);
  if (exact) return exact;
  return directory.find((item) => normalize(item.title).includes(target) || target.includes(normalize(item.title))) ?? null;
}

async function fetchNews(symbol:string,headers:Record<string,string>,start:string,end:string) {
  const url = new URL("https://data.alpaca.markets/v1beta1/news");
  url.searchParams.set("symbols",symbol);
  url.searchParams.set("start",start);
  url.searchParams.set("end",end);
  url.searchParams.set("limit","50");
  url.searchParams.set("sort","desc");
  const response = await fetch(url,{ headers });
  if (!response.ok) throw new Error(`News provider returned ${response.status}.`);
  const payload = await response.json() as { news?:NewsStory[] };
  return payload.news ?? [];
}

function deriveProduct(symbol:string,companyName:string,stories:NewsStory[]):ProductProfile {
  const known = PROFILES[symbol];
  if (known) return known;
  const launchStory = stories.find((story) => /launch|unveil|introduc|debut|release/i.test(`${story.headline} ${story.summary ?? ""}`));
  const product = launchStory?.headline.match(/(?:launches|unveils|introduces|debuts|releases)\s+(?:its\s+|new\s+)?([^,:;]{3,54})/i)?.[1]?.trim();
  return {
    company:companyName,
    product:product || "Core product platform",
    direction:"Scaling the product themes receiving the strongest concentration of launches, partnerships, and customer adoption",
    category:"its primary product market",
    peers:[],
    keywords:product ? product.split(/\s+/).filter((word) => word.length > 3).slice(0,4) : [],
  };
}

function analyzeCompany(symbol:string,companyName:string,profile:ProductProfile,stories:NewsStory[]) {
  const scored = stories.map((story) => ({ story,...storyScore(story,profile.keywords) }));
  const average = scored.length ? scored.reduce((sum,item) => sum + item.tone,0) / scored.length : 50;
  const productStories = scored.filter((item) => item.productHits.length);
  const productAverage = productStories.length ? productStories.reduce((sum,item) => sum + item.tone,0) / productStories.length : average;
  const momentumEvents = scored.reduce((sum,item) => sum + item.momentum.length,0);
  const recency = scored.filter((item) => Date.now() - new Date(item.story.created_at).getTime() < 7 * 86400000).length;
  const raceScore = Math.round(clamp(productAverage * .62 + Math.min(16,momentumEvents * 2) + Math.min(10,recency * 1.5) + Math.min(8,stories.length / 3)));
  const sentiment = average >= 61 ? "positive" : average <= 42 ? "cautious" : "mixed";
  const confidence = Math.round(clamp(42 + Math.min(28,stories.length * 2) + Math.min(20,productStories.length * 4)));
  const signals = scored.flatMap((item) => [...item.positive.map((word) => `Positive: ${word}`),...item.negative.map((word) => `Risk: ${word}`),...item.momentum.map((word) => `Momentum: ${word}`)]);
  const counts = new Map<string,number>();
  for (const signal of signals) counts.set(signal,(counts.get(signal) ?? 0) + 1);
  const keySignals = [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0,4).map(([label,count]) => `${label} (${count})`);
  return {
    symbol,companyName,product:profile.product,direction:profile.direction,category:profile.category,
    sentiment,sentimentScore:Math.round(average),raceScore,confidence,mentionCount:stories.length,
    productMentionCount:productStories.length,keySignals,
  };
}

export async function POST(request:Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Sign in required." },{ status:401 });
  const body = await request.json().catch(() => ({})) as { company?:string;profile?:string };
  const query = body.company?.trim();
  if (!query) return Response.json({ error:"Enter a company name or stock ticker." },{ status:400 });
  const credentials = await getUserCredentials(user.email,body.profile === "live" ? "live" : "paper").catch(() => null);
  if (!credentials) return Response.json({ error:"Connect an Alpaca account in Settings to research live news." },{ status:400 });

  try {
    const directory = await companyDirectory();
    const company = resolveCompany(query,directory);
    if (!company) return Response.json({ error:`We could not match “${query}” to a U.S. public company. Try its stock ticker.` },{ status:404 });
    const headers = { "APCA-API-KEY-ID":credentials.keyId,"APCA-API-SECRET-KEY":credentials.secretKey };
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 86400000);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    const primaryStories = await fetchNews(company.ticker,headers,start,end);
    const profile = deriveProduct(company.ticker,company.title,primaryStories);
    const inferredPeers = primaryStories.flatMap((story) => story.symbols ?? []).filter((symbol) => symbol !== company.ticker);
    const peerCounts = new Map<string,number>();
    for (const symbol of inferredPeers) peerCounts.set(symbol,(peerCounts.get(symbol) ?? 0) + 1);
    const peers = [...new Set([...profile.peers,...[...peerCounts.entries()].sort((a,b) => b[1]-a[1]).map(([symbol]) => symbol)])].slice(0,3);
    const peerRecords = peers.map((symbol) => directory.find((item) => item.ticker === symbol)).filter((item):item is CompanyRecord => Boolean(item));
    const peerStories = await Promise.all(peerRecords.map((peer) => fetchNews(peer.ticker,headers,start,end).catch(() => [])));
    const primaryAnalysis = analyzeCompany(company.ticker,company.title,profile,primaryStories);
    const competitors = peerRecords.map((peer,index) => {
      const peerProfile = deriveProduct(peer.ticker,peer.title,peerStories[index]);
      return analyzeCompany(peer.ticker,peer.title,peerProfile,peerStories[index]);
    });
    const race = [primaryAnalysis,...competitors].sort((a,b) => b.raceScore-a.raceScore).map((item,index) => ({ ...item,rank:index+1,isTarget:item.symbol === company.ticker }));
    const leader = race[0];
    const advantage = leader.symbol === company.ticker
      ? `${company.title} currently leads this news-momentum read, with the strongest blend of product attention, positive tone, and recent execution signals.`
      : `${leader.companyName} currently has the strongest news momentum in this race. ${company.title} ranks #${race.find((item) => item.symbol === company.ticker)?.rank ?? race.length}, so its product evidence needs to strengthen to close the gap.`;

    return Response.json({
      company:{ ticker:company.ticker,name:company.title },
      period:{ start,end,days:30 },
      analysis:primaryAnalysis,
      headlines:primaryStories.slice(0,24).map((story) => ({
        id:story.id,headline:story.headline,summary:story.summary ?? "",source:story.source,createdAt:story.created_at,url:story.url ?? "",
        ...storyScore(story,profile.keywords),
      })),
      race,
      verdict:{ leader:leader.companyName,advantage,category:profile.category },
      methodology:"Pulse analyzed headlines and provider article summaries published in the last 30 days. Sentiment combines positive, risk, product, execution, and recency signals; race scores are comparative research indicators, not forecasts.",
    });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Market intelligence is temporarily unavailable." },{ status:502 });
  }
}
