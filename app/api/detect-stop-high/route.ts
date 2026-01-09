import { NextRequest, NextResponse } from 'next/server';
import {
  loadApiKey,
  getStockListV2,
  filterTargetMarkets,
  getAllStocksLatestPrices,
  filterStocksByPrice,
  getStockPriceThreeMonths,
} from '@/lib/jquants-api';
import { detectStopHigh } from '@/lib/stop-high-detector';

/**
 * APIリクエストの型定義
 */
interface DetectStopHighRequest {
  minPrice?: number;
  maxPrice?: number;
  maxStocks?: number;
  delay?: number;
}

/**
 * ストップ高検出結果の型定義
 */
interface StopHighDetectionResult {
  銘柄コード: string;
  銘柄名: string;
  市場: string;
  ストップ高回数: number;
  最新ストップ高日: string;
  最新ストップ高価格: number | null;
  最新終値: number | null;
  直前取引日もストップ高: string;
  ストップ高で終了: string;
  寄り付きストップ高: string;
}

/**
 * 進捗メッセージを送信するヘルパー関数
 */
function sendProgress(
  controller: ReadableStreamDefaultController,
  message: string,
  type: 'log' | 'result' | 'error' = 'log'
) {
  const data = JSON.stringify({ type, message }) + '\n';
  controller.enqueue(new TextEncoder().encode(data));
}

export async function POST(request: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body: DetectStopHighRequest = await request.json();
        const minPrice = body.minPrice ?? 100;
        const maxPrice = body.maxPrice ?? 600;
        const maxStocks = body.maxStocks;
        const delay = body.delay ?? 600; // ミリ秒

        sendProgress(controller, 'ストップ高検出処理を開始します...');
        sendProgress(controller, 'APIキーを読み込み中...');

        // APIキーの読み込み
        const apiKey = loadApiKey();
        sendProgress(controller, 'APIキーの読み込み完了');

        // ステップ1: 銘柄一覧を取得
        sendProgress(controller, '【ステップ1】銘柄一覧を取得中...');
        const stockList = await getStockListV2(apiKey);
        if (stockList.length === 0) {
          sendProgress(controller, 'エラー: 銘柄一覧が取得できませんでした', 'error');
          controller.close();
          return;
        }
        sendProgress(controller, `銘柄一覧を取得しました: ${stockList.length} 件`);

        // 対象市場でフィルタリング
        sendProgress(controller, '対象市場でフィルタリング中...');
        const filteredStocks = filterTargetMarkets(stockList);
        if (filteredStocks.length === 0) {
          sendProgress(controller, 'エラー: 対象市場の銘柄が見つかりませんでした', 'error');
          controller.close();
          return;
        }
        sendProgress(controller, `対象市場銘柄数: ${filteredStocks.length} 件`);

        // ステップ2: 最新取引日の全銘柄株価を一括取得
        sendProgress(controller, '【ステップ2】最新取引日の全銘柄株価を一括取得中...');
        const { prices, tradeDate } = await getAllStocksLatestPrices(apiKey, 7);
        if (prices.length === 0) {
          sendProgress(controller, 'エラー: 株価データが取得できませんでした', 'error');
          controller.close();
          return;
        }
        sendProgress(
          controller,
          `株価データを取得しました: ${prices.length} 件 (取引日: ${tradeDate?.toISOString().slice(0, 10) || 'N/A'})`
        );

        // ステップ3: 価格でフィルタリング
        sendProgress(controller, `【ステップ3】価格でフィルタリング中... (${minPrice}円 〜 ${maxPrice}円)`);
        const priceFilteredStocks = filterStocksByPrice(
          prices,
          filteredStocks,
          minPrice,
          maxPrice
        );

        if (priceFilteredStocks.length === 0) {
          sendProgress(controller, 'エラー: 条件に合致する銘柄が見つかりませんでした', 'error');
          controller.close();
          return;
        }
        sendProgress(controller, `価格フィルタリング結果: ${priceFilteredStocks.length} 銘柄`);

        // テスト用に銘柄数を制限
        const targetStocks = maxStocks
          ? priceFilteredStocks.slice(0, maxStocks)
          : priceFilteredStocks;

        if (maxStocks && maxStocks < priceFilteredStocks.length) {
          sendProgress(controller, `テストモード: 処理銘柄数を ${maxStocks} 件に制限しました`);
        }

        // ステップ4: 各銘柄のストップ高を検出
        sendProgress(controller, `【ステップ4】各銘柄のストップ高を検出中...`);
        sendProgress(controller, `処理対象銘柄数: ${targetStocks.length} 件`);
        const results: StopHighDetectionResult[] = [];
        let errorCount = 0;

        for (let i = 0; i < targetStocks.length; i++) {
          const stockInfo = targetStocks[i];
          sendProgress(
            controller,
            `[${i + 1}/${targetStocks.length}] 処理中: ${stockInfo.code} (${stockInfo.companyName})`
          );

          try {
            // 過去3ヶ月の株価データを取得
            const stockPrices = await getStockPriceThreeMonths(
              apiKey,
              stockInfo.code,
              3
            );

            if (stockPrices.length === 0) {
              sendProgress(controller, `  → データなし`);
              continue;
            }

            // ストップ高を検出
            const stopHighResult = detectStopHigh(stockPrices, 0.13);

            if (stopHighResult.count > 0) {
              // 最新終値を取得
              const latestClose =
                stockPrices.length > 0
                  ? stockPrices[stockPrices.length - 1].Close
                  : null;

              results.push({
                銘柄コード: stockInfo.code,
                銘柄名: stockInfo.companyName,
                市場: stockInfo.market,
                ストップ高回数: stopHighResult.count,
                最新ストップ高日: stopHighResult.latestDate || '',
                最新ストップ高価格: stopHighResult.latestPrice,
                最新終値: latestClose,
                直前取引日もストップ高: stopHighResult.prevDayStopHigh ? '○' : '×',
                ストップ高で終了: stopHighResult.closedAtStopHigh ? '○' : '×',
                寄り付きストップ高: stopHighResult.openingStopHigh ? '○' : '×',
              });
              sendProgress(
                controller,
                `  → ストップ高検出: ${stopHighResult.count} 回 (最新: ${stopHighResult.latestDate})`
              );
            } else {
              sendProgress(controller, `  → ストップ高なし`);
            }

            // 進捗表示（10件ごと）
            if ((i + 1) % 10 === 0) {
              sendProgress(controller, `  進捗: ${i + 1}/${targetStocks.length} 件完了`);
            }

            // APIレート制限対策
            if (i < targetStocks.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          } catch (error: any) {
            errorCount++;
            sendProgress(controller, `  → エラー: ${error.message}`, 'error');
            // エラーが多すぎる場合は処理を停止
            if (errorCount >= 10) {
              sendProgress(controller, `エラー数が上限（10）に達しました。処理を停止します。`, 'error');
              break;
            }
            if (i < targetStocks.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        // 最終結果を送信
        sendProgress(controller, '【ステップ5】処理完了');
        sendProgress(controller, `取引日: ${tradeDate?.toISOString().slice(0, 10) || 'N/A'}`);
        sendProgress(controller, `処理対象銘柄数: ${targetStocks.length} 件`);
        sendProgress(controller, `ストップ高検出銘柄数: ${results.length} 件`);
        sendProgress(controller, `エラー数: ${errorCount} 件`);

        if (results.length > 0) {
          sendProgress(controller, '--- 検出結果 ---');
          results.forEach((result) => {
            sendProgress(
              controller,
              `${result.銘柄コード} ${result.銘柄名}: ストップ高 ${result.ストップ高回数}回 (最新: ${result.最新ストップ高日})`
            );
          });
        } else {
          sendProgress(controller, 'ストップ高をつけた銘柄は見つかりませんでした。');
        }

        // 最終結果をJSON形式で送信
        const finalResult = JSON.stringify({
          type: 'result',
          data: {
            success: true,
            tradeDate: tradeDate?.toISOString().slice(0, 10) || null,
            results,
            summary: {
              処理対象銘柄数: targetStocks.length,
              ストップ高検出銘柄数: results.length,
              エラー数: errorCount,
            },
          },
        });
        controller.enqueue(new TextEncoder().encode(finalResult + '\n'));
        controller.close();
      } catch (error: any) {
        console.error('エラー:', error);
        sendProgress(controller, `エラー: ${error.message || 'エラーが発生しました'}`, 'error');
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
