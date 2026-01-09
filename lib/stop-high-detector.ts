import { PriceData } from './jquants-api';

/**
 * ストップ高検出結果の型定義
 */
export interface StopHighResult {
  count: number;
  latestDate: string | null;
  latestPrice: number | null;
  prevDayStopHigh: boolean;
  closedAtStopHigh: boolean;
  openingStopHigh: boolean;
}

/**
 * 株価データからストップ高を検出する
 * 
 * ストップ高の判定: 前日比で一定率（デフォルト13%）以上上昇した日をストップ高と判定
 */
export function detectStopHigh(
  prices: PriceData[],
  thresholdRate: number = 0.13
): StopHighResult {
  if (prices.length === 0) {
    return {
      count: 0,
      latestDate: null,
      latestPrice: null,
      prevDayStopHigh: false,
      closedAtStopHigh: false,
      openingStopHigh: false,
    };
  }
  
  // 日付でソート（古い順）
  const sortedPrices = [...prices].sort((a, b) => a.Date.localeCompare(b.Date));
  
  const stopHighDays: Array<{
    date: string;
    high: number;
    close: number;
    open: number;
    prevClose: number;
    riseRate: number;
    closeRiseRate: number;
  }> = [];
  
  for (let i = 1; i < sortedPrices.length; i++) {
    const current = sortedPrices[i];
    const prev = sortedPrices[i - 1];
    
    const prevClose = prev.Close;
    const riseRate = (current.High - prevClose) / prevClose;
    const closeRiseRate = (current.Close - prevClose) / prevClose;
    
    if (riseRate >= thresholdRate) {
      stopHighDays.push({
        date: current.Date,
        high: current.High,
        close: current.Close,
        open: current.Open,
        prevClose,
        riseRate,
        closeRiseRate,
      });
    }
  }
  
  if (stopHighDays.length === 0) {
    return {
      count: 0,
      latestDate: null,
      latestPrice: null,
      prevDayStopHigh: false,
      closedAtStopHigh: false,
      openingStopHigh: false,
    };
  }
  
  // 最新のストップ高日を取得
  const latestStopHigh = stopHighDays[stopHighDays.length - 1];
  
  // 直前の取引日もストップ高だったか
  let prevDayStopHigh = false;
  if (stopHighDays.length >= 2) {
    const prevStopHigh = stopHighDays[stopHighDays.length - 2];
    const latestDate = new Date(latestStopHigh.date);
    const prevDate = new Date(prevStopHigh.date);
    const daysDiff = (latestDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
    // 連続した取引日の場合（1日違い）
    prevDayStopHigh = daysDiff <= 1;
  }
  
  // ストップ高で終わったか（終値が前日比13%以上上昇している）
  const closedAtStopHigh = latestStopHigh.closeRiseRate >= thresholdRate;
  
  // 寄り付きストップ高（始値と終値が一致または非常に近い）
  const openingStopHigh =
    Math.abs(latestStopHigh.open - latestStopHigh.close) < 0.01 &&
    latestStopHigh.riseRate >= thresholdRate;
  
  return {
    count: stopHighDays.length,
    latestDate: latestStopHigh.date,
    latestPrice: latestStopHigh.high,
    prevDayStopHigh,
    closedAtStopHigh,
    openingStopHigh,
  };
}
