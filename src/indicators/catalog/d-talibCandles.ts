/**
 * GENERATED: a literal TypeScript port of TA-Lib's 61 candlestick pattern functions (ta-lib/ta_codegen/input/cdl*,
 * BSD licence, (c) 1999-2026 Mario Fortier and contributors), with the same candle settings and running totals so
 * the output matches TA-Lib exactly: +100 bullish, -100 bearish (Hikkake +-200 = confirmed), 0 none.
 * Translated mechanically from the C (not hand-edited); volumePatterns.test.ts checks it bar-for-bar against TA-Lib 0.8.3.
 *
 * TA-Lib licence (reproduced as its BSD terms require):
 * Copyright (c) 1999-2026, Mario Fortier
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/** Candle settings: [range type (0 real body, 1 high-low, 2 shadows), average period, factor]. TA-Lib defaults. */
const S = {
  BodyLong: [0, 10, 1.0],
  BodyVeryLong: [0, 10, 3.0],
  BodyShort: [0, 10, 1.0],
  BodyDoji: [1, 10, 0.1],
  ShadowLong: [0, 0, 1.0],
  ShadowVeryLong: [0, 0, 2.0],
  ShadowShort: [2, 10, 1.0],
  ShadowVeryShort: [1, 10, 0.1],
  Near: [1, 5, 0.2],
  Far: [1, 5, 0.6],
  Equal: [1, 5, 0.05],
};
type Setting = keyof typeof S;
let inOpen: number[] = [];
let inHigh: number[] = [];
let inLow: number[] = [];
let inClose: number[] = [];
const realbody = (i: number) => Math.abs(inClose[i] - inOpen[i]);
const candlecolor = (i: number) => (inClose[i] >= inOpen[i] ? 1 : -1);
const uppershadow = (i: number) => inHigh[i] - (inClose[i] >= inOpen[i] ? inClose[i] : inOpen[i]);
const lowershadow = (i: number) => (inClose[i] >= inOpen[i] ? inOpen[i] : inClose[i]) - inLow[i];
const gapup = (a: number, b: number) => Math.min(inOpen[a], inClose[a]) > Math.max(inOpen[b], inClose[b]);
const gapdown = (a: number, b: number) => Math.max(inOpen[a], inClose[a]) < Math.min(inOpen[b], inClose[b]);
function rangeOf(type: number, i: number): number {
  return type === 0 ? realbody(i) : type === 1 ? inHigh[i] - inLow[i] : type === 2 ? uppershadow(i) + lowershadow(i) : 0;
}
const rg = (s: Setting, i: number) => rangeOf(S[s][0], i);
function av(s: Setting, sum: number, i: number): number {
  const [type, period, factor] = S[s];
  return (factor * (period !== 0 ? sum / period : rangeOf(type, i))) / (type === 2 ? 2.0 : 1.0);
}
function cdl2crows_lookback(): number
{
   return S['BodyLong'][1] + 2;
}
function cdl2crows(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl2crows_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         candlecolor(i-1) == -1 &&
         gapup(i-1, i-2) &&
         candlecolor(i) == -1 &&
         inOpen[i] < inOpen[i-1] && inOpen[i] > inClose[i-1] &&
         inClose[i] > inOpen[i-2] && inClose[i] < inClose[i-2]
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdl3blackcrows_lookback(): number
{
   return S['ShadowVeryShort'][1] + 3;
}
function cdl3blackcrows(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3blackcrows_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[2] = 0;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[2] += rg('ShadowVeryShort', i-2);
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-3) == 1 &&
         candlecolor(i-2) == -1 &&
         candlecolor(i-1) == -1 &&
         candlecolor(i) == -1 &&
         inOpen[i-1] < inOpen[i-2] && inOpen[i-1] > inClose[i-2] &&
         inOpen[i] < inOpen[i-1] && inOpen[i] > inClose[i-1] &&
         inHigh[i-3] > inClose[i-2] &&
         inClose[i-2] > inClose[i-1] &&
         inClose[i-1] > inClose[i] &&
         lowershadow(i-2) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[2], i-2) &&
         lowershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 2; totIdx >= 0; --totIdx)
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      i++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdl3inside_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 2;
}
function cdl3inside(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3inside_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx -1 - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx-1 ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( Math.max( inClose[i-1], inOpen[i-1] ) < Math.max( inClose[i-2], inOpen[i-2] ) &&
         Math.min( inClose[i-1], inOpen[i-1] ) > Math.min( inClose[i-2], inOpen[i-2] ) &&
         ( ( candlecolor(i-2) == 1 && candlecolor(i) == -1 && inClose[i] < inOpen[i-2] )
         ||
         ( candlecolor(i-2) == -1 && candlecolor(i) == 1 && inClose[i] > inOpen[i-2] )
      ) &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyShort', BodyShortPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = -candlecolor(i-2) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i-1) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdl3linestrike_lookback(): number
{
   return S['Near'][1] + 3;
}
function cdl3linestrike(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let NearPeriodTotal = [0, 0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3linestrike_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   NearPeriodTotal[3] = 0;
   NearPeriodTotal[2] = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal[3] += rg('Near', i-3);
      NearPeriodTotal[2] += rg('Near', i-2);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-3) == candlecolor(i-2) &&
         candlecolor(i-2) == candlecolor(i-1) &&
         candlecolor(i) == -candlecolor(i-1) &&
         inOpen[i-2] >= Math.min( inOpen[i-3], inClose[i-3] ) - av('Near', NearPeriodTotal[3], i-3) &&
         inOpen[i-2] <= Math.max( inOpen[i-3], inClose[i-3] ) + av('Near', NearPeriodTotal[3], i-3) &&
         inOpen[i-1] >= Math.min( inOpen[i-2], inClose[i-2] ) - av('Near', NearPeriodTotal[2], i-2) &&
         inOpen[i-1] <= Math.max( inOpen[i-2], inClose[i-2] ) + av('Near', NearPeriodTotal[2], i-2) &&
         (
         (
         candlecolor(i-1) == 1 &&
         inClose[i-1] > inClose[i-2] && inClose[i-2] > inClose[i-3] &&
         inOpen[i] > inClose[i-1] &&
         inClose[i] < inOpen[i-3]
      ) ||
         (
         candlecolor(i-1) == -1 &&
         inClose[i-1] < inClose[i-2] && inClose[i-2] < inClose[i-3] &&
         inOpen[i] < inClose[i-1] &&
         inClose[i] > inOpen[i-3]
      )
      )
      ) {
         outInteger[outIdx++] = candlecolor(i-1) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 3; totIdx >= 2; --totIdx)
         NearPeriodTotal[totIdx] += rg('Near', i-totIdx)
      - rg('Near', NearTrailingIdx-totIdx);
      i++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdl3outside_lookback(): number
{
   return 3;
}
function cdl3outside(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let i = 0, outIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3outside_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( ( candlecolor(i-1) == 1 && candlecolor(i-2) == -1 &&
         inClose[i-1] > inOpen[i-2] && inOpen[i-1] < inClose[i-2] &&
         inClose[i] > inClose[i-1]
      )
         ||
         ( candlecolor(i-1) == -1 && candlecolor(i-2) == 1 &&
         inOpen[i-1] > inClose[i-2] && inClose[i-1] < inOpen[i-2] &&
         inClose[i] < inClose[i-1]
      )
      )
      {
         outInteger[outIdx++] = candlecolor(i-1) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      i++;
   } while( i <= endIdx );
   return;
}
function cdl3starsinsouth_lookback(): number
{
   return Math.max( Math.max( S['ShadowVeryShort'][1], S['ShadowLong'][1] ),
      Math.max( S['BodyLong'][1], S['BodyShort'][1] )
   ) + 2;
}
function cdl3starsinsouth(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0, BodyShortPeriodTotal = 0, ShadowLongPeriodTotal = 0;
   let ShadowVeryShortPeriodTotal = [0, 0];
   let i = 0, outIdx = 0, totIdx = 0, BodyLongTrailingIdx = 0, BodyShortTrailingIdx = 0, ShadowLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3starsinsouth_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   BodyShortPeriodTotal = 0;
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-2);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i-2);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         candlecolor(i-1) == -1 &&
         candlecolor(i) == -1 &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         lowershadow(i-2) > av('ShadowLong', ShadowLongPeriodTotal, i-2) &&
         realbody(i-1) < realbody(i-2) &&
         inOpen[i-1] > inClose[i-2] && inOpen[i-1] <= inHigh[i-2] &&
         inLow[i-1] < inClose[i-2] &&
         inLow[i-1] >= inLow[i-2] &&
         lowershadow(i-1) > av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         realbody(i) < av('BodyShort', BodyShortPeriodTotal, i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         inLow[i] > inLow[i-1] && inHigh[i] < inHigh[i-1]
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2)
      - rg('BodyLong', BodyLongTrailingIdx-2);
      ShadowLongPeriodTotal += rg('ShadowLong', i-2)
      - rg('ShadowLong', ShadowLongTrailingIdx-2);
      for (totIdx = 1; totIdx >= 0; --totIdx)
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      BodyShortPeriodTotal += rg('BodyShort', i)
      - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      ShadowLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdl3whitesoldiers_lookback(): number
{
   return Math.max( Math.max( S['ShadowVeryShort'][1], S['BodyShort'][1] ),
      Math.max( S['Far'][1], S['Near'][1] )
   ) + 2;
}
function cdl3whitesoldiers(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0, 0];
   let NearPeriodTotal = [0, 0, 0];
   let FarPeriodTotal = [0, 0, 0];
   let BodyShortPeriodTotal = 0;
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, NearTrailingIdx = 0, FarTrailingIdx = 0, BodyShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdl3whitesoldiers_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[2] = 0;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   NearPeriodTotal[2] = 0;
   NearPeriodTotal[1] = 0;
   NearPeriodTotal[0] = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   FarPeriodTotal[2] = 0;
   FarPeriodTotal[1] = 0;
   FarPeriodTotal[0] = 0;
   FarTrailingIdx = startIdx - S['Far'][1];
   BodyShortPeriodTotal = 0;
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[2] += rg('ShadowVeryShort', i-2);
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal[2] += rg('Near', i-2);
      NearPeriodTotal[1] += rg('Near', i-1);
      i++;
   }
   i = FarTrailingIdx;
   while( i < startIdx ) {
      FarPeriodTotal[2] += rg('Far', i-2);
      FarPeriodTotal[1] += rg('Far', i-1);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         uppershadow(i-2) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[2], i-2) &&
         candlecolor(i-1) == 1 &&
         uppershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         candlecolor(i) == 1 &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         inClose[i] > inClose[i-1] && inClose[i-1] > inClose[i-2] &&
         inOpen[i-1] > inOpen[i-2] &&
         inOpen[i-1] <= inClose[i-2] + av('Near', NearPeriodTotal[2], i-2) &&
         inOpen[i] > inOpen[i-1] &&
         inOpen[i] <= inClose[i-1] + av('Near', NearPeriodTotal[1], i-1) &&
         realbody(i-1) > realbody(i-2) - av('Far', FarPeriodTotal[2], i-2) &&
         realbody(i) > realbody(i-1) - av('Far', FarPeriodTotal[1], i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 2; totIdx >= 0; --totIdx)
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      for (totIdx = 2; totIdx >= 1; --totIdx) {
         FarPeriodTotal[totIdx] += rg('Far', i-totIdx)
         - rg('Far', FarTrailingIdx-totIdx);
         NearPeriodTotal[totIdx] += rg('Near', i-totIdx)
         - rg('Near', NearTrailingIdx-totIdx);
      }
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      ShadowVeryShortTrailingIdx++;
      NearTrailingIdx++;
      FarTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlabandonedbaby_lookback(): number
{
   return Math.max( Math.max( S['BodyDoji'][1], S['BodyLong'][1] ),
      S['BodyShort'][1]
   ) + 2;
}
function cdlabandonedbaby(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyDojiPeriodTotal = 0, BodyLongPeriodTotal = 0, BodyShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, BodyLongTrailingIdx = 0, BodyShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlabandonedbaby_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyDojiPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyDojiTrailingIdx = startIdx -1 - S['BodyDoji'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyDojiTrailingIdx;
   while( i < startIdx-1 ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyDoji', BodyDojiPeriodTotal, i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal, i) &&
         ( ( candlecolor(i-2) == 1 &&
         candlecolor(i) == -1 &&
         inClose[i] < inClose[i-2] - realbody(i-2) * optInPenetration &&
         (inLow[i-1] > inHigh[i-2]) &&
         (inHigh[i] < inLow[i-1])
      )
         ||
         (
         candlecolor(i-2) == -1 &&
         candlecolor(i) == 1 &&
         inClose[i] > inClose[i-2] + realbody(i-2) * optInPenetration &&
         (inHigh[i-1] < inLow[i-2]) &&
         (inLow[i] > inHigh[i-1])
      )
      )
      )
      {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else
      {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyDojiPeriodTotal += rg('BodyDoji', i-1) - rg('BodyDoji', BodyDojiTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyDojiTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdladvanceblock_lookback(): number
{
   return Math.max( Math.max( Math.max( S['ShadowLong'][1], S['ShadowShort'][1] ),
      Math.max( S['Far'][1], S['Near'][1] ) ),
      S['BodyLong'][1]
   ) + 2;
}
function cdladvanceblock(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowShortPeriodTotal = [0, 0, 0];
   let ShadowLongPeriodTotal = [0, 0];
   let NearPeriodTotal = [0, 0, 0];
   let FarPeriodTotal = [0, 0, 0];
   let BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, totIdx = 0, BodyLongTrailingIdx = 0, ShadowShortTrailingIdx = 0, ShadowLongTrailingIdx = 0, NearTrailingIdx = 0, FarTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdladvanceblock_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowShortPeriodTotal[2] = 0;
   ShadowShortPeriodTotal[1] = 0;
   ShadowShortPeriodTotal[0] = 0;
   ShadowShortTrailingIdx = startIdx - S['ShadowShort'][1];
   ShadowLongPeriodTotal[1] = 0;
   ShadowLongPeriodTotal[0] = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   NearPeriodTotal[2] = 0;
   NearPeriodTotal[1] = 0;
   NearPeriodTotal[0] = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   FarPeriodTotal[2] = 0;
   FarPeriodTotal[1] = 0;
   FarPeriodTotal[0] = 0;
   FarTrailingIdx = startIdx - S['Far'][1];
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = ShadowShortTrailingIdx;
   while( i < startIdx ) {
      ShadowShortPeriodTotal[2] += rg('ShadowShort', i-2);
      ShadowShortPeriodTotal[1] += rg('ShadowShort', i-1);
      ShadowShortPeriodTotal[0] += rg('ShadowShort', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal[1] += rg('ShadowLong', i-1);
      ShadowLongPeriodTotal[0] += rg('ShadowLong', i);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal[2] += rg('Near', i-2);
      NearPeriodTotal[1] += rg('Near', i-1);
      i++;
   }
   i = FarTrailingIdx;
   while( i < startIdx ) {
      FarPeriodTotal[2] += rg('Far', i-2);
      FarPeriodTotal[1] += rg('Far', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-2);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         candlecolor(i-1) == 1 &&
         candlecolor(i) == 1 &&
         inClose[i] > inClose[i-1] && inClose[i-1] > inClose[i-2] &&
         inOpen[i-1] > inOpen[i-2] &&
         inOpen[i-1] <= inClose[i-2] + av('Near', NearPeriodTotal[2], i-2) &&
         inOpen[i] > inOpen[i-1] &&
         inOpen[i] <= inClose[i-1] + av('Near', NearPeriodTotal[1], i-1) &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         uppershadow(i-2) < av('ShadowShort', ShadowShortPeriodTotal[2], i-2) &&
         (
         (
         realbody(i-1) < realbody(i-2) - av('Far', FarPeriodTotal[2], i-2) &&
         realbody(i) < realbody(i-1) + av('Near', NearPeriodTotal[1], i-1)
      ) ||
         (
         realbody(i) < realbody(i-1) - av('Far', FarPeriodTotal[1], i-1)
      ) ||
         (
         realbody(i) < realbody(i-1) &&
         realbody(i-1) < realbody(i-2) &&
         (
         uppershadow(i) > av('ShadowShort', ShadowShortPeriodTotal[0], i) ||
         uppershadow(i-1) > av('ShadowShort', ShadowShortPeriodTotal[1], i-1)
      )
      ) ||
         (
         realbody(i) < realbody(i-1) &&
         uppershadow(i) > av('ShadowLong', ShadowLongPeriodTotal[0], i)
      )
      )
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 2; totIdx >= 0; --totIdx)
         ShadowShortPeriodTotal[totIdx] += rg('ShadowShort', i-totIdx)
      - rg('ShadowShort', ShadowShortTrailingIdx-totIdx);
      for (totIdx = 1; totIdx >= 0; --totIdx)
         ShadowLongPeriodTotal[totIdx] += rg('ShadowLong', i-totIdx)
      - rg('ShadowLong', ShadowLongTrailingIdx-totIdx);
      for (totIdx = 2; totIdx >= 1; --totIdx) {
         FarPeriodTotal[totIdx] += rg('Far', i-totIdx)
         - rg('Far', FarTrailingIdx-totIdx);
         NearPeriodTotal[totIdx] += rg('Near', i-totIdx)
         - rg('Near', NearTrailingIdx-totIdx);
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx-2);
      i++;
      ShadowShortTrailingIdx++;
      ShadowLongTrailingIdx++;
      NearTrailingIdx++;
      FarTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlbelthold_lookback(): number
{
   return Math.max( S['BodyLong'][1], S['ShadowVeryShort'][1] );
}
function cdlbelthold(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlbelthold_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) > av('BodyLong', BodyLongPeriodTotal, i) &&
         (
         (
         candlecolor(i) == 1 &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) ||
         (
         candlecolor(i) == -1 &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      )
      ) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i) - rg('BodyLong', BodyLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlbreakaway_lookback(): number
{
   return S['BodyLong'][1] + 4;
}
function cdlbreakaway(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlbreakaway_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-4);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-4) == candlecolor(i-3) &&
         candlecolor(i-3) == candlecolor(i-1) &&
         candlecolor(i-1) == -candlecolor(i) &&
         realbody(i-4) > av('BodyLong', BodyLongPeriodTotal, i-4) &&
         (
         ( candlecolor(i-4) == -1 &&
         gapdown(i-3, i-4) &&
         inHigh[i-2] < inHigh[i-3] && inLow[i-2] < inLow[i-3] &&
         inHigh[i-1] < inHigh[i-2] && inLow[i-1] < inLow[i-2] &&
         inClose[i] > inOpen[i-3] && inClose[i] < inClose[i-4]
      )
         ||
         ( candlecolor(i-4) == 1 &&
         gapup(i-3, i-4) &&
         inHigh[i-2] > inHigh[i-3] && inLow[i-2] > inLow[i-3] &&
         inHigh[i-1] > inHigh[i-2] && inLow[i-1] > inLow[i-2] &&
         inClose[i] < inOpen[i-3] && inClose[i] > inClose[i-4]
      )
      )
      ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-4)
      - rg('BodyLong', BodyLongTrailingIdx-4);
      i++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlclosingmarubozu_lookback(): number
{
   return Math.max( S['BodyLong'][1], S['ShadowVeryShort'][1] );
}
function cdlclosingmarubozu(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlclosingmarubozu_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) > av('BodyLong', BodyLongPeriodTotal, i) &&
         (
         (
         candlecolor(i) == 1 &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) ||
         (
         candlecolor(i) == -1 &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      )
      ) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i) - rg('BodyLong', BodyLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlconcealbabyswall_lookback(): number
{
   return S['ShadowVeryShort'][1] + 3;
}
function cdlconcealbabyswall(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlconcealbabyswall_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[3] = 0;
   ShadowVeryShortPeriodTotal[2] = 0;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[3] += rg('ShadowVeryShort', i-3);
      ShadowVeryShortPeriodTotal[2] += rg('ShadowVeryShort', i-2);
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-3) == -1 &&
         candlecolor(i-2) == -1 &&
         candlecolor(i-1) == -1 &&
         candlecolor(i) == -1 &&
         lowershadow(i-3) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[3], i-3) &&
         uppershadow(i-3) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[3], i-3) &&
         lowershadow(i-2) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[2], i-2) &&
         uppershadow(i-2) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[2], i-2) &&
         gapdown(i-1, i-2) &&
         uppershadow(i-1) > av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         inHigh[i-1] > inClose[i-2] &&
         inHigh[i] > inHigh[i-1] && inLow[i] < inLow[i-1]
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 3; totIdx >= 1; --totIdx)
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      i++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlcounterattack_lookback(): number
{
   return Math.max( S['Equal'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlcounterattack(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0;
   let BodyLongPeriodTotal = [0, 0];
   let i = 0, outIdx = 0, totIdx = 0, EqualTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlcounterattack_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   BodyLongPeriodTotal[1] = 0;
   BodyLongPeriodTotal[0] = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal[1] += rg('BodyLong', i-1);
      BodyLongPeriodTotal[0] += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -candlecolor(i) &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal[1], i-1) &&
         realbody(i) > av('BodyLong', BodyLongPeriodTotal[0], i) &&
         inClose[i] <= inClose[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inClose[i] >= inClose[i-1] - av('Equal', EqualPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      for (totIdx = 1; totIdx >= 0; --totIdx)
         BodyLongPeriodTotal[totIdx] += rg('BodyLong', i-totIdx)
      - rg('BodyLong', BodyLongTrailingIdx-totIdx);
      i++;
      EqualTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdldarkcloudcover_lookback(): number
{
   return S['BodyLong'][1] + 1;
}
function cdldarkcloudcover(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdldarkcloudcover_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == 1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         candlecolor(i) == -1 &&
         inOpen[i] > inHigh[i-1] &&
         inClose[i] > inOpen[i-1] &&
         inClose[i] < inClose[i-1] - realbody(i-1) * optInPenetration
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-1) - rg('BodyLong', BodyLongTrailingIdx-1);
      i++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdldoji_lookback(): number
{
   return S['BodyDoji'][1];
}
function cdldoji(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdldoji_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdldojistar_lookback(): number
{
   return Math.max( S['BodyDoji'][1], S['BodyLong'][1] ) + 1;
}
function cdldojistar(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdldojistar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyDojiPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -1 - S['BodyLong'][1];
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-1 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         ( ( candlecolor(i-1) == 1 && gapup(i, i-1) )
         ||
         ( candlecolor(i-1) == -1 && gapdown(i, i-1) )
      ) ) {
         outInteger[outIdx++] = -candlecolor(i-1) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-1) - rg('BodyLong', BodyLongTrailingIdx);
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyDojiTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdldragonflydoji_lookback(): number
{
   return Math.max( S['BodyDoji'][1], S['ShadowVeryShort'][1] );
}
function cdldragonflydoji(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdldragonflydoji_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         lowershadow(i) > av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlengulfing_lookback(): number
{
   return 2;
}
function cdlengulfing(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let i = 0, outIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlengulfing_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( ( candlecolor(i) == 1 && candlecolor(i-1) == -1 &&
         ( ( inClose[i] >= inOpen[i-1] && inOpen[i] < inClose[i-1] ) ||
         ( inClose[i] > inOpen[i-1] && inOpen[i] <= inClose[i-1] )
      )
      )
         ||
         ( candlecolor(i) == -1 && candlecolor(i-1) == 1 &&
         ( ( inOpen[i] >= inClose[i-1] && inClose[i] < inOpen[i-1] ) ||
         ( inOpen[i] > inClose[i-1] && inClose[i] <= inOpen[i-1] )
      )
      )
      ) {
         if( inOpen[i] != inClose[i-1] && inClose[i] != inOpen[i-1] ) {
            outInteger[outIdx++] = candlecolor(i) * 100;
         }
         else {
            outInteger[outIdx++] = candlecolor(i) * 80;
         }
      }
      else {
         outInteger[outIdx++] = 0;
      }
      i++;
   } while( i <= endIdx );
   return;
}
function cdleveningdojistar_lookback(): number
{
   return Math.max( Math.max( S['BodyDoji'][1], S['BodyLong'][1] ),
      S['BodyShort'][1]
   ) + 2;
}
function cdleveningdojistar(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyDojiPeriodTotal = 0, BodyLongPeriodTotal = 0, BodyShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, BodyLongTrailingIdx = 0, BodyShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdleveningdojistar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyDojiPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyDojiTrailingIdx = startIdx -1 - S['BodyDoji'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyDojiTrailingIdx;
   while( i < startIdx-1 ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         candlecolor(i) == -1 &&
         gapup(i-1, i-2) &&
         inClose[i] < inClose[i-2] - realbody(i-2) * optInPenetration &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyDoji', BodyDojiPeriodTotal, i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyDojiPeriodTotal += rg('BodyDoji', i-1) - rg('BodyDoji', BodyDojiTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyDojiTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdleveningstar_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 2;
}
function cdleveningstar(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0, BodyShortPeriodTotal2 = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdleveningstar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyShortPeriodTotal2 = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx -1 - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx-1 ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      BodyShortPeriodTotal2 += rg('BodyShort', i+1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         candlecolor(i) == -1 &&
         gapup(i-1, i-2) &&
         inClose[i] < inClose[i-2] - realbody(i-2) * optInPenetration &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyShort', BodyShortPeriodTotal, i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal2, i)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i-1) - rg('BodyShort', BodyShortTrailingIdx);
      BodyShortPeriodTotal2 += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx+1);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlgapsidesidewhite_lookback(): number
{
   return Math.max( S['Near'][1], S['Equal'][1] ) + 2;
}
function cdlgapsidesidewhite(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let NearPeriodTotal = 0, EqualPeriodTotal = 0;
   let i = 0, outIdx = 0, NearTrailingIdx = 0, EqualTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlgapsidesidewhite_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   NearPeriodTotal = 0;
   EqualPeriodTotal = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   EqualTrailingIdx = startIdx - S['Equal'][1];
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal += rg('Near', i-1);
      i++;
   }
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if(
         (
         ( gapup(i-1, i-2) && gapup(i, i-2) )
         ||
         ( gapdown(i-1, i-2) && gapdown(i, i-2) )
      ) &&
         candlecolor(i-1) == 1 &&
         candlecolor(i) == 1 &&
         realbody(i) >= realbody(i-1) - av('Near', NearPeriodTotal, i-1) &&
         realbody(i) <= realbody(i-1) + av('Near', NearPeriodTotal, i-1) &&
         inOpen[i] >= inOpen[i-1] - av('Equal', EqualPeriodTotal, i-1) &&
         inOpen[i] <= inOpen[i-1] + av('Equal', EqualPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = ( gapup(i-1, i-2) ? 100 : -100 );
      }
      else {
         outInteger[outIdx++] = 0;
      }
      NearPeriodTotal += rg('Near', i-1) - rg('Near', NearTrailingIdx-1);
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      i++;
      NearTrailingIdx++;
      EqualTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlgravestonedoji_lookback(): number
{
   return Math.max( S['BodyDoji'][1], S['ShadowVeryShort'][1] );
}
function cdlgravestonedoji(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlgravestonedoji_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         uppershadow(i) > av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlhammer_lookback(): number
{
   return Math.max( Math.max( Math.max( S['BodyShort'][1], S['ShadowLong'][1] ),
      S['ShadowVeryShort'][1] ),
      S['Near'][1]
   ) + 1;
}
function cdlhammer(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0, NearPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlhammer_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   NearPeriodTotal = 0;
   NearTrailingIdx = startIdx -1 - S['Near'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx-1 ) {
      NearPeriodTotal += rg('Near', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         lowershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         Math.min( inClose[i], inOpen[i] ) <= inLow[i-1] + av('Near', NearPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i)
      - rg('BodyShort', BodyTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i)
      - rg('ShadowLong', ShadowLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      NearPeriodTotal += rg('Near', i-1)
      - rg('Near', NearTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlhangingman_lookback(): number
{
   return Math.max( Math.max( Math.max( S['BodyShort'][1], S['ShadowLong'][1] ),
      S['ShadowVeryShort'][1] ),
      S['Near'][1]
   ) + 1;
}
function cdlhangingman(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0, NearPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlhangingman_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   NearPeriodTotal = 0;
   NearTrailingIdx = startIdx -1 - S['Near'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx-1 ) {
      NearPeriodTotal += rg('Near', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         lowershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         Math.min( inClose[i], inOpen[i] ) >= inHigh[i-1] - av('Near', NearPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i)
      - rg('BodyShort', BodyTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i)
      - rg('ShadowLong', ShadowLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      NearPeriodTotal += rg('Near', i-1)
      - rg('Near', NearTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlharami_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 1;
}
function cdlharami(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlharami_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -1 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-1 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1)
      ) {
         if( realbody(i) <= av('BodyShort', BodyShortPeriodTotal, i)
         ) {
            if( Math.max( inClose[i], inOpen[i] ) < Math.max( inClose[i-1], inOpen[i-1] ) &&
               Math.min( inClose[i], inOpen[i] ) > Math.min( inClose[i-1], inOpen[i-1] ) ) {
               outInteger[outIdx++] = -candlecolor(i-1) * 100;
            } else if( Math.max( inClose[i], inOpen[i] ) <= Math.max( inClose[i-1], inOpen[i-1] ) &&
               Math.min( inClose[i], inOpen[i] ) >= Math.min( inClose[i-1], inOpen[i-1] ) ) {
               outInteger[outIdx++] = -candlecolor(i-1) * 80;
            } else {
               outInteger[outIdx++] = 0;
            }
         } else {
            outInteger[outIdx++] = 0;
         }
      } else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-1) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlharamicross_lookback(): number
{
   return Math.max( S['BodyDoji'][1], S['BodyLong'][1] ) + 1;
}
function cdlharamicross(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlharamicross_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyDojiPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -1 - S['BodyLong'][1];
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-1 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1)
      ) {
         if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i)
         ) {
            if ( Math.max( inClose[i], inOpen[i] ) < Math.max( inClose[i-1], inOpen[i-1] ) &&
               Math.min( inClose[i], inOpen[i] ) > Math.min( inClose[i-1], inOpen[i-1] )
            ) {
               outInteger[outIdx++] = -candlecolor(i-1) * 100;
            }
            else
               if ( Math.max( inClose[i], inOpen[i] ) <= Math.max( inClose[i-1], inOpen[i-1] ) &&
               Math.min( inClose[i], inOpen[i] ) >= Math.min( inClose[i-1], inOpen[i-1] )
            ) {
               outInteger[outIdx++] = -candlecolor(i-1) * 80;
            }
            else {
               outInteger[outIdx++] = 0;
            }
         }
         else {
            outInteger[outIdx++] = 0;
         }
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-1) - rg('BodyLong', BodyLongTrailingIdx);
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyDojiTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlhighwave_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['ShadowVeryLong'][1] );
}
function cdlhighwave(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlhighwave_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowPeriodTotal = 0;
   ShadowTrailingIdx = startIdx - S['ShadowVeryLong'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowTrailingIdx;
   while( i < startIdx ) {
      ShadowPeriodTotal += rg('ShadowVeryLong', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         uppershadow(i) > av('ShadowVeryLong', ShadowPeriodTotal, i) &&
         lowershadow(i) > av('ShadowVeryLong', ShadowPeriodTotal, i) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyTrailingIdx);
      ShadowPeriodTotal += rg('ShadowVeryLong', i) - rg('ShadowVeryLong', ShadowTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlhikkake_lookback(): number
{
   return 5;
}
function cdlhikkake(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let i = 0, outIdx = 0, lookbackTotal = 0, patternResult = 0;
   let cd = 0;
   let savedHigh = 0.0, savedLow = 0.0;
   lookbackTotal = cdlhikkake_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   cd = 0;
   patternResult = 0;
   i = startIdx - 3;
   while( i < startIdx ) {
      if( inHigh[i-1] < inHigh[i-2] && inLow[i-1] > inLow[i-2] &&
         ( ( inHigh[i] < inHigh[i-1] && inLow[i] < inLow[i-1] )
         ||
         ( inHigh[i] > inHigh[i-1] && inLow[i] > inLow[i-1] )
      )
      ) {
         patternResult = 100 * ( inHigh[i] < inHigh[i-1] ? 1 : -1 );
         savedHigh = inHigh[i-1];
         savedLow = inLow[i-1];
         cd = 4;
      } else
      if( cd > 0 &&
         ( ( patternResult > 0 && inClose[i] > savedHigh )
         ||
         ( patternResult < 0 && inClose[i] < savedLow )
      )
      ) {
         cd = 0;
      }
      if( cd > 0 ) cd--;
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( inHigh[i-1] < inHigh[i-2] && inLow[i-1] > inLow[i-2] &&
         ( ( inHigh[i] < inHigh[i-1] && inLow[i] < inLow[i-1] )
         ||
         ( inHigh[i] > inHigh[i-1] && inLow[i] > inLow[i-1] )
      )
      ) {
         patternResult = 100 * ( inHigh[i] < inHigh[i-1] ? 1 : -1 );
         savedHigh = inHigh[i-1];
         savedLow = inLow[i-1];
         cd = 4;
         outInteger[outIdx++] = patternResult;
      } else
      if( cd > 0 &&
         ( ( patternResult > 0 && inClose[i] > savedHigh )
         ||
         ( patternResult < 0 && inClose[i] < savedLow )
      )
      ) {
         outInteger[outIdx++] = patternResult + 100 * ( patternResult > 0 ? 1 : -1 );
         cd = 0;
      } else {
         outInteger[outIdx++] = 0;
      }
      if( cd > 0 ) cd--;
      i++;
   } while( i <= endIdx );
   return;
}
function cdlhikkakemod_lookback(): number
{
   return Math.max( 1, S['Near'][1] ) + 5;
}
function cdlhikkakemod(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let NearPeriodTotal = 0;
   let i = 0, outIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0, patternResult = 0;
   let patternCount = 0;
   let patternHigh = 0, patternLow = 0;
   lookbackTotal = cdlhikkakemod_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   NearPeriodTotal = 0;
   NearTrailingIdx = startIdx - 3 - S['Near'][1];
   i = NearTrailingIdx;
   while( i < startIdx - 3 ) {
      NearPeriodTotal += rg('Near', i-2);
      i++;
   }
   patternCount = 0;
   patternResult = 0;
   patternHigh = 0.0;
   patternLow = 0.0;
   i = startIdx - 3;
   while( i < startIdx ) {
      if( inHigh[i-2] < inHigh[i-3] && inLow[i-2] > inLow[i-3] &&
         inHigh[i-1] < inHigh[i-2] && inLow[i-1] > inLow[i-2] &&
         ( ( inHigh[i] < inHigh[i-1] && inLow[i] < inLow[i-1] &&
         inClose[i-2] <= inLow[i-2] + av('Near', NearPeriodTotal, i-2)
      )
         ||
         ( inHigh[i] > inHigh[i-1] && inLow[i] > inLow[i-1] &&
         inClose[i-2] >= inHigh[i-2] - av('Near', NearPeriodTotal, i-2)
      )
      )
      ) {
         patternResult = 100 * ( inHigh[i] < inHigh[i-1] ? 1 : -1 );
         patternHigh = inHigh[i-1];
         patternLow = inLow[i-1];
         patternCount = 4;
      } else
      if( patternCount > 0 &&
         ( ( patternResult > 0 && inClose[i] > patternHigh )
         ||
         ( patternResult < 0 && inClose[i] < patternLow )
      )
      ) {
         patternCount = 0;
      }
      NearPeriodTotal += rg('Near', i-2) - rg('Near', NearTrailingIdx-2);
      NearTrailingIdx++;
      if( patternCount > 0 ) patternCount--;
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( inHigh[i-2] < inHigh[i-3] && inLow[i-2] > inLow[i-3] &&
         inHigh[i-1] < inHigh[i-2] && inLow[i-1] > inLow[i-2] &&
         ( ( inHigh[i] < inHigh[i-1] && inLow[i] < inLow[i-1] &&
         inClose[i-2] <= inLow[i-2] + av('Near', NearPeriodTotal, i-2)
      )
         ||
         ( inHigh[i] > inHigh[i-1] && inLow[i] > inLow[i-1] &&
         inClose[i-2] >= inHigh[i-2] - av('Near', NearPeriodTotal, i-2)
      )
      )
      ) {
         patternResult = 100 * ( inHigh[i] < inHigh[i-1] ? 1 : -1 );
         patternHigh = inHigh[i-1];
         patternLow = inLow[i-1];
         patternCount = 4;
         outInteger[outIdx++] = patternResult;
      } else
      if( patternCount > 0 &&
         ( ( patternResult > 0 && inClose[i] > patternHigh )
         ||
         ( patternResult < 0 && inClose[i] < patternLow )
      )
      ) {
         outInteger[outIdx++] = patternResult + 100 * ( patternResult > 0 ? 1 : -1 );
         patternCount = 0;
      } else {
         outInteger[outIdx++] = 0;
      }
      NearPeriodTotal += rg('Near', i-2) - rg('Near', NearTrailingIdx-2);
      NearTrailingIdx++;
      if( patternCount > 0 ) patternCount--;
      i++;
   } while( i <= endIdx );
   return;
}
function cdlhomingpigeon_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 1;
}
function cdlhomingpigeon(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlhomingpigeon_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-1);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         candlecolor(i) == -1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         realbody(i) <= av('BodyShort', BodyShortPeriodTotal, i) &&
         inOpen[i] < inOpen[i-1] &&
         inClose[i] > inClose[i-1]
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-1) - rg('BodyLong', BodyLongTrailingIdx-1);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlidentical3crows_lookback(): number
{
   return Math.max( S['ShadowVeryShort'][1], S['Equal'][1]
   ) + 2;
}
function cdlidentical3crows(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0, 0];
   let EqualPeriodTotal = [0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, EqualTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlidentical3crows_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[2] = 0;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   EqualPeriodTotal[2] = 0;
   EqualPeriodTotal[1] = 0;
   EqualPeriodTotal[0] = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[2] += rg('ShadowVeryShort', i-2);
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal[2] += rg('Equal', i-2);
      EqualPeriodTotal[1] += rg('Equal', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         lowershadow(i-2) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[2], i-2) &&
         candlecolor(i-1) == -1 &&
         lowershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         candlecolor(i) == -1 &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         inClose[i-2] > inClose[i-1] &&
         inClose[i-1] > inClose[i] &&
         inOpen[i-1] <= inClose[i-2] + av('Equal', EqualPeriodTotal[2], i-2) &&
         inOpen[i-1] >= inClose[i-2] - av('Equal', EqualPeriodTotal[2], i-2) &&
         inOpen[i] <= inClose[i-1] + av('Equal', EqualPeriodTotal[1], i-1) &&
         inOpen[i] >= inClose[i-1] - av('Equal', EqualPeriodTotal[1], i-1)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 2; totIdx >= 0; --totIdx)
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      for (totIdx = 2; totIdx >= 1; --totIdx)
         EqualPeriodTotal[totIdx] += rg('Equal', i-totIdx)
      - rg('Equal', EqualTrailingIdx-totIdx);
      i++;
      ShadowVeryShortTrailingIdx++;
      EqualTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlinneck_lookback(): number
{
   return Math.max( S['Equal'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlinneck(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, EqualTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlinneck_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         candlecolor(i) == 1 &&
         inOpen[i] < inLow[i-1] &&
         inClose[i] <= inClose[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inClose[i] >= inClose[i-1]
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      BodyLongPeriodTotal += rg('BodyLong', i-1)
      - rg('BodyLong', BodyLongTrailingIdx-1);
      i++;
      EqualTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlinvertedhammer_lookback(): number
{
   return Math.max( Math.max( S['BodyShort'][1], S['ShadowLong'][1] ),
      S['ShadowVeryShort'][1]
   ) + 1;
}
function cdlinvertedhammer(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlinvertedhammer_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( gapdown(i, i-1) &&
         realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         uppershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i)
      - rg('BodyShort', BodyTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i)
      - rg('ShadowLong', ShadowLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlkicking_lookback(): number
{
   return Math.max( S['ShadowVeryShort'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlkicking(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0];
   let BodyLongPeriodTotal = [0, 0];
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlkicking_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   BodyLongPeriodTotal[1] = 0;
   BodyLongPeriodTotal[0] = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal[1] += rg('BodyLong', i-1);
      BodyLongPeriodTotal[0] += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -candlecolor(i) &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal[1], i-1) &&
         uppershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         lowershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         realbody(i) > av('BodyLong', BodyLongPeriodTotal[0], i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         (
         ( candlecolor(i-1) == -1 && (inLow[i] > inHigh[i-1]) )
         ||
         ( candlecolor(i-1) == 1 && (inHigh[i] < inLow[i-1]) )
      )
      ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 1; totIdx >= 0; --totIdx) {
         BodyLongPeriodTotal[totIdx] += rg('BodyLong', i-totIdx)
         - rg('BodyLong', BodyLongTrailingIdx-totIdx);
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
         - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      }
      i++;
      ShadowVeryShortTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlkickingbylength_lookback(): number
{
   return Math.max( S['ShadowVeryShort'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlkickingbylength(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = [0, 0];
   let BodyLongPeriodTotal = [0, 0];
   let i = 0, outIdx = 0, totIdx = 0, ShadowVeryShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlkickingbylength_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal[1] = 0;
   ShadowVeryShortPeriodTotal[0] = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   BodyLongPeriodTotal[1] = 0;
   BodyLongPeriodTotal[0] = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal[1] += rg('ShadowVeryShort', i-1);
      ShadowVeryShortPeriodTotal[0] += rg('ShadowVeryShort', i);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal[1] += rg('BodyLong', i-1);
      BodyLongPeriodTotal[0] += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -candlecolor(i) &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal[1], i-1) &&
         uppershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         lowershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[1], i-1) &&
         realbody(i) > av('BodyLong', BodyLongPeriodTotal[0], i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal[0], i) &&
         (
         ( candlecolor(i-1) == -1 && (inLow[i] > inHigh[i-1]) )
         ||
         ( candlecolor(i-1) == 1 && (inHigh[i] < inLow[i-1]) )
      )
      ) {
         outInteger[outIdx++] = candlecolor(( realbody(i) > realbody(i-1) ? i : i-1 )) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 1; totIdx >= 0; --totIdx) {
         BodyLongPeriodTotal[totIdx] += rg('BodyLong', i-totIdx)
         - rg('BodyLong', BodyLongTrailingIdx-totIdx);
         ShadowVeryShortPeriodTotal[totIdx] += rg('ShadowVeryShort', i-totIdx)
         - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-totIdx);
      }
      i++;
      ShadowVeryShortTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlladderbottom_lookback(): number
{
   return S['ShadowVeryShort'][1] + 4;
}
function cdlladderbottom(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlladderbottom_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if(
         candlecolor(i-4) == -1 && candlecolor(i-3) == -1 && candlecolor(i-2) == -1 &&
         inOpen[i-4] > inOpen[i-3] && inOpen[i-3] > inOpen[i-2] &&
         inClose[i-4] > inClose[i-3] && inClose[i-3] > inClose[i-2] &&
         candlecolor(i-1) == -1 &&
         uppershadow(i-1) > av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i-1) &&
         candlecolor(i) == 1 &&
         inOpen[i] > inOpen[i-1] &&
         inClose[i] > inHigh[i-1]
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i-1)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-1);
      i++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdllongleggeddoji_lookback(): number
{
   return Math.max( S['BodyDoji'][1], S['ShadowLong'][1] );
}
function cdllongleggeddoji(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, ShadowLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, ShadowLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdllongleggeddoji_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         ( lowershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i)
         ||
         uppershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i)
      )
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i) - rg('ShadowLong', ShadowLongTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
      ShadowLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdllongline_lookback(): number
{
   return Math.max( S['BodyLong'][1], S['ShadowShort'][1] );
}
function cdllongline(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdllongline_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyLong'][1];
   ShadowPeriodTotal = 0;
   ShadowTrailingIdx = startIdx - S['ShadowShort'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = ShadowTrailingIdx;
   while( i < startIdx ) {
      ShadowPeriodTotal += rg('ShadowShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) > av('BodyLong', BodyPeriodTotal, i) &&
         uppershadow(i) < av('ShadowShort', ShadowPeriodTotal, i) &&
         lowershadow(i) < av('ShadowShort', ShadowPeriodTotal, i) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyLong', i) - rg('BodyLong', BodyTrailingIdx);
      ShadowPeriodTotal += rg('ShadowShort', i) - rg('ShadowShort', ShadowTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlmarubozu_lookback(): number
{
   return Math.max( S['BodyLong'][1], S['ShadowVeryShort'][1] );
}
function cdlmarubozu(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlmarubozu_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) > av('BodyLong', BodyLongPeriodTotal, i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i) - rg('BodyLong', BodyLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlmatchinglow_lookback(): number
{
   return S['Equal'][1] + 1;
}
function cdlmatchinglow(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0;
   let i = 0, outIdx = 0, EqualTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlmatchinglow_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         candlecolor(i) == -1 &&
         inClose[i] <= inClose[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inClose[i] >= inClose[i-1] - av('Equal', EqualPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      i++;
      EqualTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlmathold_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 4;
}
function cdlmathold(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyPeriodTotal = [0, 0, 0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlmathold_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal[4] = 0;
   BodyPeriodTotal[3] = 0;
   BodyPeriodTotal[2] = 0;
   BodyPeriodTotal[1] = 0;
   BodyPeriodTotal[0] = 0;
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal[3] += rg('BodyShort', i-3);
      BodyPeriodTotal[2] += rg('BodyShort', i-2);
      BodyPeriodTotal[1] += rg('BodyShort', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal[4] += rg('BodyLong', i-4);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if(
         candlecolor(i-4) == 1 &&
         candlecolor(i-3) == -1 &&
         candlecolor(i) == 1 &&
         gapup(i-3, i-4) &&
         Math.min(inOpen[i-2], inClose[i-2]) < inClose[i-4] &&
         Math.min(inOpen[i-1], inClose[i-1]) < inClose[i-4] &&
         Math.min(inOpen[i-2], inClose[i-2]) > inClose[i-4] - realbody(i-4) * optInPenetration &&
         Math.min(inOpen[i-1], inClose[i-1]) > inClose[i-4] - realbody(i-4) * optInPenetration &&
         Math.max(inClose[i-2], inOpen[i-2]) < inOpen[i-3] &&
         Math.max(inClose[i-1], inOpen[i-1]) < Math.max(inClose[i-2], inOpen[i-2]) &&
         inOpen[i] > inClose[i-1] &&
         inClose[i] > Math.max(Math.max(inHigh[i-3], inHigh[i-2]), inHigh[i-1]) &&
         realbody(i-4) > av('BodyLong', BodyPeriodTotal[4], i-4) &&
         realbody(i-3) < av('BodyShort', BodyPeriodTotal[3], i-3) &&
         realbody(i-2) < av('BodyShort', BodyPeriodTotal[2], i-2) &&
         realbody(i-1) < av('BodyShort', BodyPeriodTotal[1], i-1)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal[4] += rg('BodyLong', i-4) - rg('BodyLong', BodyLongTrailingIdx-4);
      for (totIdx = 3; totIdx >= 1; --totIdx)
         BodyPeriodTotal[totIdx] += rg('BodyShort', i-totIdx)
      - rg('BodyShort', BodyShortTrailingIdx-totIdx);
      i++;
      BodyShortTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlmorningdojistar_lookback(): number
{
   return Math.max( Math.max( S['BodyDoji'][1], S['BodyLong'][1] ),
      S['BodyShort'][1]
   ) + 2;
}
function cdlmorningdojistar(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyDojiPeriodTotal = 0, BodyLongPeriodTotal = 0, BodyShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, BodyLongTrailingIdx = 0, BodyShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlmorningdojistar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyDojiPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyDojiTrailingIdx = startIdx -1 - S['BodyDoji'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyDojiTrailingIdx;
   while( i < startIdx-1 ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         candlecolor(i) == 1 &&
         gapdown(i-1, i-2) &&
         inClose[i] > inClose[i-2] + realbody(i-2) * optInPenetration &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyDoji', BodyDojiPeriodTotal, i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyDojiPeriodTotal += rg('BodyDoji', i-1) - rg('BodyDoji', BodyDojiTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyDojiTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlmorningstar_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 2;
}
function cdlmorningstar(startIdx: number, endIdx: number, outInteger: number[], optInPenetration: number): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0, BodyShortPeriodTotal2 = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlmorningstar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyShortPeriodTotal2 = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx -1 - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx-1 ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      BodyShortPeriodTotal2 += rg('BodyShort', i+1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         candlecolor(i) == 1 &&
         gapdown(i-1, i-2) &&
         inClose[i] > inClose[i-2] + realbody(i-2) * optInPenetration &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyShort', BodyShortPeriodTotal, i-1) &&
         realbody(i) > av('BodyShort', BodyShortPeriodTotal2, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i-1) - rg('BodyShort', BodyShortTrailingIdx);
      BodyShortPeriodTotal2 += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx+1);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlonneck_lookback(): number
{
   return Math.max( S['Equal'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlonneck(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, EqualTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlonneck_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         candlecolor(i) == 1 &&
         inOpen[i] < inLow[i-1] &&
         inClose[i] <= inLow[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inClose[i] >= inLow[i-1] - av('Equal', EqualPeriodTotal, i-1)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      BodyLongPeriodTotal += rg('BodyLong', i-1)
      - rg('BodyLong', BodyLongTrailingIdx-1);
      i++;
      EqualTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlpiercing_lookback(): number
{
   return S['BodyLong'][1] + 1;
}
function cdlpiercing(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = [0, 0];
   let i = 0, outIdx = 0, totIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlpiercing_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal[1] = 0;
   BodyLongPeriodTotal[0] = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal[1] += rg('BodyLong', i-1);
      BodyLongPeriodTotal[0] += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal[1], i-1) &&
         candlecolor(i) == 1 &&
         realbody(i) > av('BodyLong', BodyLongPeriodTotal[0], i) &&
         inOpen[i] < inLow[i-1] &&
         inClose[i] < inOpen[i-1] &&
         inClose[i] > inClose[i-1] + realbody(i-1) * 0.5
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 1; totIdx >= 0; --totIdx)
         BodyLongPeriodTotal[totIdx] += rg('BodyLong', i-totIdx)
      - rg('BodyLong', BodyLongTrailingIdx-totIdx);
      i++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlrickshawman_lookback(): number
{
   return Math.max( Math.max( S['BodyDoji'][1], S['ShadowLong'][1] ),
      S['Near'][1]
   );
}
function cdlrickshawman(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, ShadowLongPeriodTotal = 0, NearPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, ShadowLongTrailingIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlrickshawman_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   NearPeriodTotal = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal += rg('Near', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         lowershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         uppershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         (
         Math.min( inOpen[i], inClose[i] )
         <= inLow[i] + (inHigh[i] - inLow[i]) / 2 + av('Near', NearPeriodTotal, i)
         &&
         Math.max( inOpen[i], inClose[i] )
         >= inLow[i] + (inHigh[i] - inLow[i]) / 2 - av('Near', NearPeriodTotal, i)
      )
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i) - rg('ShadowLong', ShadowLongTrailingIdx);
      NearPeriodTotal += rg('Near', i) - rg('Near', NearTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
      ShadowLongTrailingIdx++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlrisefall3methods_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 4;
}
function cdlrisefall3methods(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = [0, 0, 0, 0, 0];
   let i = 0, outIdx = 0, totIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlrisefall3methods_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal[4] = 0;
   BodyPeriodTotal[3] = 0;
   BodyPeriodTotal[2] = 0;
   BodyPeriodTotal[1] = 0;
   BodyPeriodTotal[0] = 0;
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal[3] += rg('BodyShort', i-3);
      BodyPeriodTotal[2] += rg('BodyShort', i-2);
      BodyPeriodTotal[1] += rg('BodyShort', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal[4] += rg('BodyLong', i-4);
      BodyPeriodTotal[0] += rg('BodyLong', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if(
         candlecolor(i-4) == -candlecolor(i-3) &&
         candlecolor(i-3) ==  candlecolor(i-2) &&
         candlecolor(i-2) ==  candlecolor(i-1) &&
         candlecolor(i-1) == -candlecolor(i) &&
         Math.min(inOpen[i-3], inClose[i-3]) < inHigh[i-4] && Math.max(inOpen[i-3], inClose[i-3]) > inLow[i-4] &&
         Math.min(inOpen[i-2], inClose[i-2]) < inHigh[i-4] && Math.max(inOpen[i-2], inClose[i-2]) > inLow[i-4] &&
         Math.min(inOpen[i-1], inClose[i-1]) < inHigh[i-4] && Math.max(inOpen[i-1], inClose[i-1]) > inLow[i-4] &&
         inClose[i-2] * candlecolor(i-4) < inClose[i-3] * candlecolor(i-4) &&
         inClose[i-1] * candlecolor(i-4) < inClose[i-2] * candlecolor(i-4) &&
         inOpen[i] * candlecolor(i-4) > inClose[i-1] * candlecolor(i-4) &&
         inClose[i] * candlecolor(i-4) > inClose[i-4] * candlecolor(i-4) &&
         realbody(i-4) > av('BodyLong', BodyPeriodTotal[4], i-4) &&
         realbody(i-3) < av('BodyShort', BodyPeriodTotal[3], i-3) &&
         realbody(i-2) < av('BodyShort', BodyPeriodTotal[2], i-2) &&
         realbody(i-1) < av('BodyShort', BodyPeriodTotal[1], i-1) &&
         realbody(i)   > av('BodyLong', BodyPeriodTotal[0], i)
      ) {
         outInteger[outIdx++] = 100 * candlecolor(i-4);
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal[4] += rg('BodyLong', i-4) - rg('BodyLong', BodyLongTrailingIdx-4);
      for (totIdx = 3; totIdx >= 1; --totIdx)
         BodyPeriodTotal[totIdx] += rg('BodyShort', i-totIdx)
      - rg('BodyShort', BodyShortTrailingIdx-totIdx);
      BodyPeriodTotal[0] += rg('BodyLong', i) - rg('BodyLong', BodyLongTrailingIdx);
      i++;
      BodyShortTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlseparatinglines_lookback(): number
{
   return Math.max( Math.max( S['ShadowVeryShort'][1], S['BodyLong'][1] ),
      S['Equal'][1]
   ) + 1;
}
function cdlseparatinglines(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let ShadowVeryShortPeriodTotal = 0, BodyLongPeriodTotal = 0, EqualPeriodTotal = 0;
   let i = 0, outIdx = 0, ShadowVeryShortTrailingIdx = 0, BodyLongTrailingIdx = 0, EqualTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlseparatinglines_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -candlecolor(i) &&
         inOpen[i] <= inOpen[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inOpen[i] >= inOpen[i-1] - av('Equal', EqualPeriodTotal, i-1) &&
         realbody(i) > av('BodyLong', BodyLongPeriodTotal, i) &&
         (
         ( candlecolor(i) == 1 &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      )
         ||
         ( candlecolor(i) == -1 &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      )
      )
      ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      BodyLongPeriodTotal += rg('BodyLong', i) - rg('BodyLong', BodyLongTrailingIdx);
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      i++;
      ShadowVeryShortTrailingIdx++;
      BodyLongTrailingIdx++;
      EqualTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlshootingstar_lookback(): number
{
   return Math.max( Math.max( S['BodyShort'][1], S['ShadowLong'][1] ),
      S['ShadowVeryShort'][1]
   ) + 1;
}
function cdlshootingstar(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowLongPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowLongTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlshootingstar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowLongPeriodTotal = 0;
   ShadowLongTrailingIdx = startIdx - S['ShadowLong'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowLongTrailingIdx;
   while( i < startIdx ) {
      ShadowLongPeriodTotal += rg('ShadowLong', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( gapup(i, i-1) &&
         realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         uppershadow(i) > av('ShadowLong', ShadowLongPeriodTotal, i) &&
         lowershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i)
      - rg('BodyShort', BodyTrailingIdx);
      ShadowLongPeriodTotal += rg('ShadowLong', i)
      - rg('ShadowLong', ShadowLongTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowLongTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlshortline_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['ShadowShort'][1] );
}
function cdlshortline(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0, ShadowPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, ShadowTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlshortline_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowPeriodTotal = 0;
   ShadowTrailingIdx = startIdx - S['ShadowShort'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowTrailingIdx;
   while( i < startIdx ) {
      ShadowPeriodTotal += rg('ShadowShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) < av('BodyShort', BodyPeriodTotal, i) &&
         uppershadow(i) < av('ShadowShort', ShadowPeriodTotal, i) &&
         lowershadow(i) < av('ShadowShort', ShadowPeriodTotal, i) ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyTrailingIdx);
      ShadowPeriodTotal += rg('ShadowShort', i) - rg('ShadowShort', ShadowTrailingIdx);
      i++;
      BodyTrailingIdx++;
      ShadowTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlspinningtop_lookback(): number
{
   return S['BodyShort'][1];
}
function cdlspinningtop(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlspinningtop_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyTrailingIdx;
   while( i < startIdx ) {
      BodyPeriodTotal += rg('BodyShort', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( uppershadow(i) > realbody(i) &&
         lowershadow(i) > realbody(i) &&
         realbody(i) < av('BodyShort', BodyPeriodTotal, i)
      ) {
         outInteger[outIdx++] = candlecolor(i) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyTrailingIdx);
      i++;
      BodyTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlstalledpattern_lookback(): number
{
   return Math.max( Math.max( S['BodyLong'][1], S['BodyShort'][1] ),
      Math.max( S['ShadowVeryShort'][1], S['Near'][1] )
   ) + 2;
}
function cdlstalledpattern(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyLongPeriodTotal = [0, 0, 0];
   let NearPeriodTotal = [0, 0, 0];
   let BodyShortPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0;
   let i = 0, outIdx = 0, totIdx = 0, BodyLongTrailingIdx = 0, BodyShortTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlstalledpattern_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal[2] = 0;
   BodyLongPeriodTotal[1] = 0;
   BodyLongPeriodTotal[0] = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   BodyShortPeriodTotal = 0;
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   NearPeriodTotal[2] = 0;
   NearPeriodTotal[1] = 0;
   NearPeriodTotal[0] = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal[2] += rg('BodyLong', i-2);
      BodyLongPeriodTotal[1] += rg('BodyLong', i-1);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i-1);
      i++;
   }
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal[2] += rg('Near', i-2);
      NearPeriodTotal[1] += rg('Near', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         candlecolor(i-1) == 1 &&
         candlecolor(i) == 1 &&
         inClose[i] > inClose[i-1] && inClose[i-1] > inClose[i-2] &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal[2], i-2) &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal[1], i-1) &&
         uppershadow(i-1) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i-1) &&
         inOpen[i-1] > inOpen[i-2] &&
         inOpen[i-1] <= inClose[i-2] + av('Near', NearPeriodTotal[2], i-2) &&
         realbody(i) < av('BodyShort', BodyShortPeriodTotal, i) &&
         inOpen[i] >= inClose[i-1] - realbody(i) - av('Near', NearPeriodTotal[1], i-1)
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      for (totIdx = 2; totIdx >= 1; --totIdx) {
         BodyLongPeriodTotal[totIdx] += rg('BodyLong', i-totIdx)
         - rg('BodyLong', BodyLongTrailingIdx-totIdx);
         NearPeriodTotal[totIdx] += rg('Near', i-totIdx)
         - rg('Near', NearTrailingIdx-totIdx);
      }
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i-1)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx-1);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlsticksandwich_lookback(): number
{
   return S['Equal'][1] + 2;
}
function cdlsticksandwich(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0;
   let i = 0, outIdx = 0, EqualTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlsticksandwich_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-2);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         candlecolor(i-1) == 1 &&
         candlecolor(i) == -1 &&
         inLow[i-1] > inClose[i-2] &&
         inClose[i] <= inClose[i-2] + av('Equal', EqualPeriodTotal, i-2) &&
         inClose[i] >= inClose[i-2] - av('Equal', EqualPeriodTotal, i-2)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-2) - rg('Equal', EqualTrailingIdx-2);
      i++;
      EqualTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdltakuri_lookback(): number
{
   return Math.max( Math.max( S['BodyDoji'][1], S['ShadowVeryShort'][1] ),
      S['ShadowVeryLong'][1]
   );
}
function cdltakuri(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyDojiPeriodTotal = 0, ShadowVeryShortPeriodTotal = 0, ShadowVeryLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyDojiTrailingIdx = 0, ShadowVeryShortTrailingIdx = 0, ShadowVeryLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdltakuri_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyDojiPeriodTotal = 0;
   BodyDojiTrailingIdx = startIdx - S['BodyDoji'][1];
   ShadowVeryShortPeriodTotal = 0;
   ShadowVeryShortTrailingIdx = startIdx - S['ShadowVeryShort'][1];
   ShadowVeryLongPeriodTotal = 0;
   ShadowVeryLongTrailingIdx = startIdx - S['ShadowVeryLong'][1];
   i = BodyDojiTrailingIdx;
   while( i < startIdx ) {
      BodyDojiPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = ShadowVeryShortTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i);
      i++;
   }
   i = ShadowVeryLongTrailingIdx;
   while( i < startIdx ) {
      ShadowVeryLongPeriodTotal += rg('ShadowVeryLong', i);
      i++;
   }
   outIdx = startIdx;
   do
   {
      if( realbody(i) <= av('BodyDoji', BodyDojiPeriodTotal, i) &&
         uppershadow(i) < av('ShadowVeryShort', ShadowVeryShortPeriodTotal, i) &&
         lowershadow(i) > av('ShadowVeryLong', ShadowVeryLongPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyDojiPeriodTotal += rg('BodyDoji', i) - rg('BodyDoji', BodyDojiTrailingIdx);
      ShadowVeryShortPeriodTotal += rg('ShadowVeryShort', i)
      - rg('ShadowVeryShort', ShadowVeryShortTrailingIdx);
      ShadowVeryLongPeriodTotal += rg('ShadowVeryLong', i)
      - rg('ShadowVeryLong', ShadowVeryLongTrailingIdx);
      i++;
      BodyDojiTrailingIdx++;
      ShadowVeryShortTrailingIdx++;
      ShadowVeryLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdltasukigap_lookback(): number
{
   return S['Near'][1] + 2;
}
function cdltasukigap(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let NearPeriodTotal = 0;
   let i = 0, outIdx = 0, NearTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdltasukigap_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   NearPeriodTotal = 0;
   NearTrailingIdx = startIdx - S['Near'][1];
   i = NearTrailingIdx;
   while( i < startIdx ) {
      NearPeriodTotal += rg('Near', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if(
         (
         gapup(i-1, i-2) &&
         candlecolor(i-1) == 1 &&
         candlecolor(i) == -1 &&
         inOpen[i] < inClose[i-1] && inOpen[i] > inOpen[i-1] &&
         inClose[i] < inOpen[i-1] &&
         inClose[i] > Math.max(inClose[i-2], inOpen[i-2]) &&
         Math.abs(realbody(i-1) - realbody(i)) < av('Near', NearPeriodTotal, i-1)
      ) ||
         (
         gapdown(i-1, i-2) &&
         candlecolor(i-1) == -1 &&
         candlecolor(i) == 1 &&
         inOpen[i] < inOpen[i-1] && inOpen[i] > inClose[i-1] &&
         inClose[i] > inOpen[i-1] &&
         inClose[i] < Math.min(inClose[i-2], inOpen[i-2]) &&
         Math.abs(realbody(i-1) - realbody(i)) < av('Near', NearPeriodTotal, i-1)
      )
      ) {
         outInteger[outIdx++] = candlecolor(i-1) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      NearPeriodTotal += rg('Near', i-1) - rg('Near', NearTrailingIdx-1);
      i++;
      NearTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlthrusting_lookback(): number
{
   return Math.max( S['Equal'][1], S['BodyLong'][1]
   ) + 1;
}
function cdlthrusting(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let EqualPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, EqualTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlthrusting_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   EqualPeriodTotal = 0;
   EqualTrailingIdx = startIdx - S['Equal'][1];
   BodyLongPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx - S['BodyLong'][1];
   i = EqualTrailingIdx;
   while( i < startIdx ) {
      EqualPeriodTotal += rg('Equal', i-1);
      i++;
   }
   i = BodyLongTrailingIdx;
   while( i < startIdx ) {
      BodyLongPeriodTotal += rg('BodyLong', i-1);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-1) == -1 &&
         realbody(i-1) > av('BodyLong', BodyLongPeriodTotal, i-1) &&
         candlecolor(i) == 1 &&
         inOpen[i] < inLow[i-1] &&
         inClose[i] > inClose[i-1] + av('Equal', EqualPeriodTotal, i-1) &&
         inClose[i] <= inClose[i-1] + realbody(i-1) * 0.5
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      EqualPeriodTotal += rg('Equal', i-1) - rg('Equal', EqualTrailingIdx-1);
      BodyLongPeriodTotal += rg('BodyLong', i-1)
      - rg('BodyLong', BodyLongTrailingIdx-1);
      i++;
      EqualTrailingIdx++;
      BodyLongTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdltristar_lookback(): number
{
   return S['BodyDoji'][1] + 2;
}
function cdltristar(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdltristar_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyPeriodTotal = 0;
   BodyTrailingIdx = startIdx -2 - S['BodyDoji'][1];
   i = BodyTrailingIdx;
   while( i < startIdx-2 ) {
      BodyPeriodTotal += rg('BodyDoji', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( realbody(i-2) <= av('BodyDoji', BodyPeriodTotal, i-2) &&
         realbody(i-1) <= av('BodyDoji', BodyPeriodTotal, i-2) &&
         realbody(i) <= av('BodyDoji', BodyPeriodTotal, i-2)
      ) {
         outInteger[outIdx] = 0;
         if ( gapup(i-1, i-2)
            &&
            Math.max(inOpen[i],inClose[i]) < Math.max(inOpen[i-1],inClose[i-1])
         ) {
            outInteger[outIdx] = -100;
         }
         if ( gapdown(i-1, i-2)
            &&
            Math.min(inOpen[i],inClose[i]) > Math.min(inOpen[i-1],inClose[i-1])
         ) {
            outInteger[outIdx] = +100;
         }
         outIdx++;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyPeriodTotal += rg('BodyDoji', i-2) - rg('BodyDoji', BodyTrailingIdx);
      i++;
      BodyTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlunique3river_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 2;
}
function cdlunique3river(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlunique3river_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == -1 &&
         candlecolor(i-1) == -1 &&
         candlecolor(i) == 1 &&
         inClose[i-1] > inClose[i-2] && inOpen[i-1] <= inOpen[i-2] &&
         inLow[i-1] < inLow[i-2] &&
         inOpen[i] > inLow[i-1] &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         realbody(i) < av('BodyShort', BodyShortPeriodTotal, i)
      ) {
         outInteger[outIdx++] = 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlupsidegap2crows_lookback(): number
{
   return Math.max( S['BodyShort'][1], S['BodyLong'][1] ) + 2;
}
function cdlupsidegap2crows(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let BodyShortPeriodTotal = 0, BodyLongPeriodTotal = 0;
   let i = 0, outIdx = 0, BodyShortTrailingIdx = 0, BodyLongTrailingIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlupsidegap2crows_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   BodyLongPeriodTotal = 0;
   BodyShortPeriodTotal = 0;
   BodyLongTrailingIdx = startIdx -2 - S['BodyLong'][1];
   BodyShortTrailingIdx = startIdx -1 - S['BodyShort'][1];
   i = BodyLongTrailingIdx;
   while( i < startIdx-2 ) {
      BodyLongPeriodTotal += rg('BodyLong', i);
      i++;
   }
   i = BodyShortTrailingIdx;
   while( i < startIdx-1 ) {
      BodyShortPeriodTotal += rg('BodyShort', i);
      i++;
   }
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == 1 &&
         realbody(i-2) > av('BodyLong', BodyLongPeriodTotal, i-2) &&
         candlecolor(i-1) == -1 &&
         realbody(i-1) <= av('BodyShort', BodyShortPeriodTotal, i-1) &&
         gapup(i-1, i-2) &&
         candlecolor(i) == -1 &&
         inOpen[i] > inOpen[i-1] && inClose[i] < inClose[i-1] &&
         inClose[i] > inClose[i-2]
      ) {
         outInteger[outIdx++] = -100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      BodyLongPeriodTotal += rg('BodyLong', i-2) - rg('BodyLong', BodyLongTrailingIdx);
      BodyShortPeriodTotal += rg('BodyShort', i-1) - rg('BodyShort', BodyShortTrailingIdx);
      i++;
      BodyLongTrailingIdx++;
      BodyShortTrailingIdx++;
   } while( i <= endIdx );
   return;
}
function cdlxsidegap3methods_lookback(): number
{
   return 2;
}
function cdlxsidegap3methods(startIdx: number, endIdx: number, outInteger: number[]): void
{
   let i = 0, outIdx = 0, lookbackTotal = 0;
   lookbackTotal = cdlxsidegap3methods_lookback();
   if( startIdx < lookbackTotal ) {
      startIdx = lookbackTotal;
   }
   if( startIdx > endIdx )
   return;
   i = startIdx;
   outIdx = startIdx;
   do
   {
      if( candlecolor(i-2) == candlecolor(i-1) &&
         candlecolor(i-1) == -candlecolor(i) &&
         inOpen[i] < Math.max(inClose[i-1], inOpen[i-1]) &&
         inOpen[i] > Math.min(inClose[i-1], inOpen[i-1]) &&
         inClose[i] < Math.max(inClose[i-2], inOpen[i-2]) &&
         inClose[i] > Math.min(inClose[i-2], inOpen[i-2]) &&
         ( (
         candlecolor(i-2) == 1 &&
         gapup(i-1, i-2)
      ) ||
         (
         candlecolor(i-2) == -1 &&
         gapdown(i-1, i-2)
      )
      )
      ) {
         outInteger[outIdx++] = candlecolor(i-2) * 100;
      }
      else {
         outInteger[outIdx++] = 0;
      }
      i++;
   } while( i <= endIdx );
   return;
}

type Fn = (startIdx: number, endIdx: number, out: number[], penetration: number) => void;
/** Every pattern by its TA-Lib name (e.g. CDLENGULFING): the function, its lookback, and whether it takes a penetration. */
export const CDL: Record<string, { fn: Fn; lookback: () => number; penetration: boolean }> = {
  CDL2CROWS: { fn: cdl2crows as Fn, lookback: cdl2crows_lookback, penetration: false },
  CDL3BLACKCROWS: { fn: cdl3blackcrows as Fn, lookback: cdl3blackcrows_lookback, penetration: false },
  CDL3INSIDE: { fn: cdl3inside as Fn, lookback: cdl3inside_lookback, penetration: false },
  CDL3LINESTRIKE: { fn: cdl3linestrike as Fn, lookback: cdl3linestrike_lookback, penetration: false },
  CDL3OUTSIDE: { fn: cdl3outside as Fn, lookback: cdl3outside_lookback, penetration: false },
  CDL3STARSINSOUTH: { fn: cdl3starsinsouth as Fn, lookback: cdl3starsinsouth_lookback, penetration: false },
  CDL3WHITESOLDIERS: { fn: cdl3whitesoldiers as Fn, lookback: cdl3whitesoldiers_lookback, penetration: false },
  CDLABANDONEDBABY: { fn: cdlabandonedbaby as Fn, lookback: cdlabandonedbaby_lookback, penetration: true },
  CDLADVANCEBLOCK: { fn: cdladvanceblock as Fn, lookback: cdladvanceblock_lookback, penetration: false },
  CDLBELTHOLD: { fn: cdlbelthold as Fn, lookback: cdlbelthold_lookback, penetration: false },
  CDLBREAKAWAY: { fn: cdlbreakaway as Fn, lookback: cdlbreakaway_lookback, penetration: false },
  CDLCLOSINGMARUBOZU: { fn: cdlclosingmarubozu as Fn, lookback: cdlclosingmarubozu_lookback, penetration: false },
  CDLCONCEALBABYSWALL: { fn: cdlconcealbabyswall as Fn, lookback: cdlconcealbabyswall_lookback, penetration: false },
  CDLCOUNTERATTACK: { fn: cdlcounterattack as Fn, lookback: cdlcounterattack_lookback, penetration: false },
  CDLDARKCLOUDCOVER: { fn: cdldarkcloudcover as Fn, lookback: cdldarkcloudcover_lookback, penetration: true },
  CDLDOJI: { fn: cdldoji as Fn, lookback: cdldoji_lookback, penetration: false },
  CDLDOJISTAR: { fn: cdldojistar as Fn, lookback: cdldojistar_lookback, penetration: false },
  CDLDRAGONFLYDOJI: { fn: cdldragonflydoji as Fn, lookback: cdldragonflydoji_lookback, penetration: false },
  CDLENGULFING: { fn: cdlengulfing as Fn, lookback: cdlengulfing_lookback, penetration: false },
  CDLEVENINGDOJISTAR: { fn: cdleveningdojistar as Fn, lookback: cdleveningdojistar_lookback, penetration: true },
  CDLEVENINGSTAR: { fn: cdleveningstar as Fn, lookback: cdleveningstar_lookback, penetration: true },
  CDLGAPSIDESIDEWHITE: { fn: cdlgapsidesidewhite as Fn, lookback: cdlgapsidesidewhite_lookback, penetration: false },
  CDLGRAVESTONEDOJI: { fn: cdlgravestonedoji as Fn, lookback: cdlgravestonedoji_lookback, penetration: false },
  CDLHAMMER: { fn: cdlhammer as Fn, lookback: cdlhammer_lookback, penetration: false },
  CDLHANGINGMAN: { fn: cdlhangingman as Fn, lookback: cdlhangingman_lookback, penetration: false },
  CDLHARAMI: { fn: cdlharami as Fn, lookback: cdlharami_lookback, penetration: false },
  CDLHARAMICROSS: { fn: cdlharamicross as Fn, lookback: cdlharamicross_lookback, penetration: false },
  CDLHIGHWAVE: { fn: cdlhighwave as Fn, lookback: cdlhighwave_lookback, penetration: false },
  CDLHIKKAKE: { fn: cdlhikkake as Fn, lookback: cdlhikkake_lookback, penetration: false },
  CDLHIKKAKEMOD: { fn: cdlhikkakemod as Fn, lookback: cdlhikkakemod_lookback, penetration: false },
  CDLHOMINGPIGEON: { fn: cdlhomingpigeon as Fn, lookback: cdlhomingpigeon_lookback, penetration: false },
  CDLIDENTICAL3CROWS: { fn: cdlidentical3crows as Fn, lookback: cdlidentical3crows_lookback, penetration: false },
  CDLINNECK: { fn: cdlinneck as Fn, lookback: cdlinneck_lookback, penetration: false },
  CDLINVERTEDHAMMER: { fn: cdlinvertedhammer as Fn, lookback: cdlinvertedhammer_lookback, penetration: false },
  CDLKICKING: { fn: cdlkicking as Fn, lookback: cdlkicking_lookback, penetration: false },
  CDLKICKINGBYLENGTH: { fn: cdlkickingbylength as Fn, lookback: cdlkickingbylength_lookback, penetration: false },
  CDLLADDERBOTTOM: { fn: cdlladderbottom as Fn, lookback: cdlladderbottom_lookback, penetration: false },
  CDLLONGLEGGEDDOJI: { fn: cdllongleggeddoji as Fn, lookback: cdllongleggeddoji_lookback, penetration: false },
  CDLLONGLINE: { fn: cdllongline as Fn, lookback: cdllongline_lookback, penetration: false },
  CDLMARUBOZU: { fn: cdlmarubozu as Fn, lookback: cdlmarubozu_lookback, penetration: false },
  CDLMATCHINGLOW: { fn: cdlmatchinglow as Fn, lookback: cdlmatchinglow_lookback, penetration: false },
  CDLMATHOLD: { fn: cdlmathold as Fn, lookback: cdlmathold_lookback, penetration: true },
  CDLMORNINGDOJISTAR: { fn: cdlmorningdojistar as Fn, lookback: cdlmorningdojistar_lookback, penetration: true },
  CDLMORNINGSTAR: { fn: cdlmorningstar as Fn, lookback: cdlmorningstar_lookback, penetration: true },
  CDLONNECK: { fn: cdlonneck as Fn, lookback: cdlonneck_lookback, penetration: false },
  CDLPIERCING: { fn: cdlpiercing as Fn, lookback: cdlpiercing_lookback, penetration: false },
  CDLRICKSHAWMAN: { fn: cdlrickshawman as Fn, lookback: cdlrickshawman_lookback, penetration: false },
  CDLRISEFALL3METHODS: { fn: cdlrisefall3methods as Fn, lookback: cdlrisefall3methods_lookback, penetration: false },
  CDLSEPARATINGLINES: { fn: cdlseparatinglines as Fn, lookback: cdlseparatinglines_lookback, penetration: false },
  CDLSHOOTINGSTAR: { fn: cdlshootingstar as Fn, lookback: cdlshootingstar_lookback, penetration: false },
  CDLSHORTLINE: { fn: cdlshortline as Fn, lookback: cdlshortline_lookback, penetration: false },
  CDLSPINNINGTOP: { fn: cdlspinningtop as Fn, lookback: cdlspinningtop_lookback, penetration: false },
  CDLSTALLEDPATTERN: { fn: cdlstalledpattern as Fn, lookback: cdlstalledpattern_lookback, penetration: false },
  CDLSTICKSANDWICH: { fn: cdlsticksandwich as Fn, lookback: cdlsticksandwich_lookback, penetration: false },
  CDLTAKURI: { fn: cdltakuri as Fn, lookback: cdltakuri_lookback, penetration: false },
  CDLTASUKIGAP: { fn: cdltasukigap as Fn, lookback: cdltasukigap_lookback, penetration: false },
  CDLTHRUSTING: { fn: cdlthrusting as Fn, lookback: cdlthrusting_lookback, penetration: false },
  CDLTRISTAR: { fn: cdltristar as Fn, lookback: cdltristar_lookback, penetration: false },
  CDLUNIQUE3RIVER: { fn: cdlunique3river as Fn, lookback: cdlunique3river_lookback, penetration: false },
  CDLUPSIDEGAP2CROWS: { fn: cdlupsidegap2crows as Fn, lookback: cdlupsidegap2crows_lookback, penetration: false },
  CDLXSIDEGAP3METHODS: { fn: cdlxsidegap3methods as Fn, lookback: cdlxsidegap3methods_lookback, penetration: false },
};

/** Runs one TA-Lib pattern over OHLC arrays; bars before the lookback are 0 (as in TA-Lib's Python wrapper). */
export function runCdl(name: string, open: number[], high: number[], low: number[], close: number[], penetration = 0.3): number[] {
  const f = CDL[name];
  const out = new Array<number>(close.length).fill(0);
  if (!f || close.length === 0) return out;
  inOpen = open;
  inHigh = high;
  inLow = low;
  inClose = close;
  try {
    f.fn(0, close.length - 1, out, penetration);
  } finally {
    inOpen = inHigh = inLow = inClose = [];
  }
  return out.map((v) => v || 0);
}
