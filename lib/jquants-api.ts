import fs from 'fs';
import path from 'path';

/**
 * APIキーをファイルから読み込む
 */
export function loadApiKey(): string {
  const apikeyPath = path.join(process.cwd(), 'apikey.txt');
  
  try {
    const apiKey = fs.readFileSync(apikeyPath, 'utf-8').trim();
    
    if (!apiKey) {
      throw new Error('APIキーファイルが空です');
    }
    
    return apiKey;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`APIキーファイルが見つかりません: ${apikeyPath}`);
    }
    throw new Error(`APIキーの読み込み中にエラーが発生しました: ${error.message}`);
  }
}

/**
 * 銘柄情報の型定義
 */
export interface StockInfo {
  Code: string;
  CoName?: string;
  MktNm?: string;
}

/**
 * 株価データの型定義
 */
export interface PriceData {
  Code: string;
  Date: string;
  High: number;
  Close: number;
  Open: number;
  Low: number;
  Volume: number;
}

/**
 * J-Quants API V2から銘柄一覧を取得する
 */
export async function getStockListV2(apiKey: string): Promise<StockInfo[]> {
  const baseUrl = 'https://api.jquants.com/v2/equities/master';
  
  const headers = {
    'X-API-Key': apiKey,
  };
  
  try {
    const response = await fetch(baseUrl, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTPエラー: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      return [];
    }
    
    return data.data;
  } catch (error: any) {
    throw new Error(`銘柄一覧の取得中にエラーが発生しました: ${error.message}`);
  }
}

/**
 * 対象市場（プライム、スタンダード、グロース）の銘柄のみをフィルタリングする
 */
export function filterTargetMarkets(stocks: StockInfo[]): StockInfo[] {
  const targetMarkets = ['プライム', 'スタンダード', 'グロース'];
  
  return stocks.filter((stock) => {
    const market = stock.MktNm || '';
    return targetMarkets.some((target) => market.includes(target));
  });
}

/**
 * 最新取引日の全銘柄株価を一括取得する
 */
export async function getAllStocksLatestPrices(
  apiKey: string,
  maxDays: number = 7
): Promise<{ prices: PriceData[]; tradeDate: Date | null }> {
  const baseUrl = 'https://api.jquants.com/v2/equities/bars/daily';
  const headers = {
    'X-API-Key': apiKey,
  };
  
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - maxDays);
  
  let currentDate = new Date(endDate);
  
  while (currentDate >= startDate) {
    const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
    
    try {
      const params = new URLSearchParams({ date: dateStr });
      const response = await fetch(`${baseUrl}?${params}`, { headers });
      
      if (response.status === 404) {
        // 取引日ではない可能性があるので、次の日に遡る
        currentDate.setDate(currentDate.getDate() - 1);
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      
      if (!response.ok) {
        currentDate.setDate(currentDate.getDate() - 1);
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      
      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        // V2 APIのカラム名を変換
        const prices: PriceData[] = data.data.map((item: any) => ({
          Code: item.Code,
          Date: item.Date,
          High: item.H,
          Close: item.C,
          Open: item.O,
          Low: item.L,
          Volume: item.Vo,
        }));
        
        return { prices, tradeDate: new Date(currentDate) };
      }
    } catch (error) {
      // エラー時は次の日に遡る
    }
    
    currentDate.setDate(currentDate.getDate() - 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  
  return { prices: [], tradeDate: null };
}

/**
 * 指定価格範囲の銘柄を抽出する
 */
export function filterStocksByPrice(
  prices: PriceData[],
  stocks: StockInfo[],
  minPrice: number = 100,
  maxPrice: number = 600
): Array<{
  code: string;
  companyName: string;
  market: string;
  latestPrice: number;
}> {
  const results: Array<{
    code: string;
    companyName: string;
    market: string;
    latestPrice: number;
  }> = [];
  
  if (prices.length === 0) {
    return results;
  }
  
  // 銘柄コードを正規化（5桁→4桁）
  const normalizeCode = (code: string): string => {
    const str = String(code).padStart(5, '0');
    return str.length === 5 && str.endsWith('0') ? str.slice(0, 4) : str;
  };
  
  // 最新日の終値を取得（Codeごとにグループ化）
  const latestPricesMap = new Map<string, PriceData>();
  for (const price of prices) {
    const code = normalizeCode(price.Code);
    const existing = latestPricesMap.get(code);
    if (!existing || new Date(price.Date) > new Date(existing.Date)) {
      latestPricesMap.set(code, { ...price, Code: code });
    }
  }
  
  // 価格範囲でフィルタリング
  const stockMap = new Map<string, StockInfo>();
  for (const stock of stocks) {
    stockMap.set(normalizeCode(stock.Code), stock);
  }
  
  for (const [code, price] of latestPricesMap.entries()) {
    if (price.Close >= minPrice && price.Close <= maxPrice) {
      const stock = stockMap.get(code);
      results.push({
        code,
        companyName: stock?.CoName || '',
        market: stock?.MktNm || '',
        latestPrice: price.Close,
      });
    }
  }
  
  return results;
}

/**
 * J-Quants API V2から指定された銘柄の過去3ヶ月の株価データを取得する
 */
export async function getStockPriceThreeMonths(
  apiKey: string,
  code: string,
  months: number = 3
): Promise<PriceData[]> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);
  
  const endDateStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');
  const startDateStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
  
  const baseUrl = 'https://api.jquants.com/v2/equities/bars/daily';
  const headers = {
    'X-API-Key': apiKey,
  };
  
  const params = new URLSearchParams({
    code,
    from: startDateStr,
    to: endDateStr,
  });
  
  try {
    const response = await fetch(`${baseUrl}?${params}`, { headers });
    
    if (response.status === 404) {
      return [];
    }
    
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      return [];
    }
    
    // V2 APIのカラム名を変換
    const prices: PriceData[] = data.data.map((item: any) => ({
      Code: item.Code,
      Date: item.Date,
      High: item.H,
      Close: item.C,
      Open: item.O,
      Low: item.L,
      Volume: item.Vo,
    }));
    
    // 日付でソート（古い順）
    prices.sort((a, b) => a.Date.localeCompare(b.Date));
    
    return prices;
  } catch (error: any) {
    if (error.message.includes('404')) {
      return [];
    }
    throw new Error(`株価データの取得中にエラーが発生しました: ${error.message}`);
  }
}
