import { useEffect, useState, useRef, useMemo } from 'react';
import SurfaceChart from './components/SurfaceChart';
import PerformanceChart from './components/PerformanceChart';
import ControlBar from './components/ControlBar';
import { DashboardData } from './lib/types';
import { Settings2 } from 'lucide-react';

function calculateMetrics(prices: number[]) {
    if (prices.length < 2) return { ret: 0, vol: 0, sharpe: 0 };
    
    // Daily Returns
    let returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i-1]) / prices[i-1]);
    }
    
    // Annualized Return (CAGR)
    const totalRet = (prices[prices.length - 1] / prices[0]) - 1;
    const nYears = prices.length / 252;
    const annRet = Math.pow(1 + totalRet, 1 / nYears) - 1;
    
    // Annualized Volatility
    const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / (returns.length - 1);
    const annVol = Math.sqrt(variance) * Math.sqrt(252);
    
    // Sharpe (Rf=3%)
    const rf = 0.03;
    const sharpe = (annRet - rf) / annVol;
    
    return { ret: annRet, vol: annVol, sharpe };
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [targetVol, setTargetVol] = useState(0.12); // User selectable vol target
  const [smoothing, setSmoothing] = useState(0.2); // lambda
  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>();

  useEffect(() => {
    fetch('/simulation_data.json')
      .then(res => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  // --- Dynamic Backtest Logic (GARCH + MinVar + VolTarget) ---
  const backtestResults = useMemo(() => {
    if (!data) return null;

    const { dates, raw: rawReturns, covariances } = data.returns;
    const initialCapital = data.metadata.initial_capital;
    const assetNames = data.metadata.asset_names;

    let buyHoldIndex = [initialCapital];
    let novusIndex = [initialCapital];
    let leverageHistory = [1.0];
    let trendHistory = [1];
    let weightsHistory: { [key: string]: number }[] = [];
    
    let currentWeights = [0.25, 0.25, 0.25, 0.25];
    
    // For Buy & Hold (Static Weights with H2O adjustment)
    const bhTargetWeights = [0.4, 0.32, 0.08, 0.2]; // DIGI, M, WINE, H2O
    let h2oListed = false;

    for (let i = 0; i < dates.length; i++) {
        const h_t = covariances[i];
        const dayReturns = rawReturns[i];

        if (dayReturns[3] !== 0) h2oListed = true;

        // 1. Buy & Hold Step
        if (i > 0) {
            // Dynamic B&H weights (H2O listing check)
            let bh_w = [...bhTargetWeights];
            if (!h2oListed) { 
                const norm = bh_w[0] + bh_w[1] + bh_w[2];
                bh_w = [bh_w[0]/norm, bh_w[1]/norm, bh_w[2]/norm, 0];
            }
            const bhRet = bh_w.reduce((acc, w, idx) => acc + w * dayReturns[idx], 0);
            buyHoldIndex.push(buyHoldIndex[i-1] * (1 + bhRet));
        }

        // 2. Risk Parity / Inverse Volatility (wt*) - Optimized for Robustness
        // MinVar can be unstable and produce extreme weights.
        // Inverse Volatility guarantees positive weights and handles regimes better.
        // w_i ~ 1 / sigma_i
        
        let invVolSum = 0;
        let activeIndices: number[] = [];
        let vols: number[] = [0,0,0,0];

        for (let j = 0; j < 4; j++) {
            // Check if asset has listing variance (at least 1e-7)
            // h_t[j][j] is variance.
            if (h_t[j][j] > 1e-7) {
                const vol = Math.sqrt(h_t[j][j]);
                vols[j] = vol;
                invVolSum += (1 / vol);
                activeIndices.push(j);
            }
        }

        let wt_star = [0, 0, 0, 0];
        if (activeIndices.length > 0) {
            activeIndices.forEach(idx => {
                wt_star[idx] = (1 / vols[idx]) / invVolSum;
            });
        } else {
             // Fallback
             wt_star = [0.25, 0.25, 0.25, 0.25];
        }

/* REMOVED MINVAR LOGIC
        // We only include assets that are "active" (listed and have variance)
        let activeIndices: number[] = [];
        for (let j = 0; j < 4; j++) {
            // Check if asset has listing variance (at least 1e-6)
            if (h_t[j][j] > 1e-7) {
                activeIndices.push(j);
            }
        }
        // ... (rest of minvar code)
*/

        // 3. Smooth Adjustments (wt) - Step 7
        if (i > 0) {
            currentWeights = currentWeights.map((w, idx) => (1 - smoothing) * w + smoothing * wt_star[idx]);
        } else {
            currentWeights = wt_star;
        }

        // 4. Trend Filter (SMA 10/50)
        let trend = 1;
        if (i > 50) {
            const sma50 = buyHoldIndex.slice(i-50, i).reduce((a,b) => a+b,0) / 50;
            const sma10 = buyHoldIndex.slice(i-10, i).reduce((a,b) => a+b,0) / 10;
            trend = (buyHoldIndex[i] > sma50 || sma10 > sma50) ? 1 : 0;
        }
        trendHistory.push(trend);

        // 5. Volatility Targeting - Step 8
        // Forecasted Portfolio Vol: sqrt(w' H_t w)
        let portVar = 0;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                portVar += currentWeights[r] * h_t[r][c] * currentWeights[c];
            }
        }
        // Ensure portVar is positive and not NaN
        const safePortVar = Math.max(1e-10, isNaN(portVar) ? 0 : portVar);
        const portVol = Math.sqrt(safePortVar * 252); // Annualized

        let lev = targetVol / portVol;
        if (trend === 0) lev *= 0.5;
        // Check for NaN or Infinity in leverage
        if (isNaN(lev) || !isFinite(lev)) lev = 0.05;
        lev = Math.min(lev, 3.0); // Increased cap from 1.0 to 3.0 to allow leverage
        lev = Math.max(lev, 0.05);
        leverageHistory.push(lev);

        // 6. Novus Return
        if (i > 0) {
            const appliedLev = leverageHistory[i-1];
            const appliedWeights = weightsHistory[i-1];
            const basketRet = assetNames.reduce((acc, name, idx) => {
                return acc + appliedWeights[name] * dayReturns[idx];
            }, 0);
            novusIndex.push(novusIndex[i-1] * (1 + basketRet * appliedLev));
        }

        // Save current weights (as object for UI)
        let weightObj: { [key: string]: number } = {};
        assetNames.forEach((n, idx) => weightObj[n] = currentWeights[idx]);
        weightsHistory.push(weightObj);
    }

    return { buyHoldIndex, novusIndex, leverageHistory, trendHistory, weightsHistory };
  }, [data, targetVol, smoothing]);

  const animate = (time: number) => {
    if (lastTimeRef.current !== undefined) {
      const deltaTime = time - lastTimeRef.current;
      const interval = 30 / speed;
      
      if (deltaTime > interval) {
         setCurrentIndex(prev => {
             if (!data) return 0;
             if (prev >= data.returns.dates.length - 1) {
                 setIsPlaying(false);
                 return prev;
             }
             return prev + 1;
         });
         lastTimeRef.current = time;
      }
    } else {
        lastTimeRef.current = time;
    }
    if (isPlaying) {
        requestRef.current = requestAnimationFrame(animate);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      lastTimeRef.current = undefined;
    }
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  }, [isPlaying, speed, data]);

  if (!data || !backtestResults) return <div className="flex items-center justify-center h-screen text-black">INITIALIZING HISTORICAL ENGINE...</div>;

  const { buyHoldIndex, novusIndex, leverageHistory, trendHistory, weightsHistory } = backtestResults;

  // Derived Metrics for Current Frame
  const currentDate = data.returns.dates[currentIndex];
  const currentLev = leverageHistory[currentIndex];
  const isUptrend = trendHistory[currentIndex] === 1;
  const bhVal = buyHoldIndex[currentIndex];
  const novVal = novusIndex[currentIndex];
  
  const bhReturn = ((bhVal / data.metadata.initial_capital) - 1) * 100;
  const novusReturn = ((novVal / data.metadata.initial_capital) - 1) * 100;

  const novMetrics = calculateMetrics(novusIndex.slice(0, currentIndex+1));
  const bhMetrics = calculateMetrics(buyHoldIndex.slice(0, currentIndex+1));

  // Dynamic Weights for current frame
  const currentBaseWeights = weightsHistory[currentIndex];

  // Status Logic
  let status = "SYSTEM OPTIMAL";
  let statusColor = "text-novus-green";
  if (currentLev < 0.5) {
      status = "CRASH PROTOCOL";
      statusColor = "text-novus-red animate-pulse";
  } else if (!isUptrend) {
      status = "TREND FILTER";
      statusColor = "text-yellow-500";
  }

  return (
    <div className="min-h-screen bg-novus-bg p-4 flex flex-col gap-4 font-sans text-gray-700 overflow-hidden">
      
      {/* Header */}
      <header className="flex justify-between items-center border-b border-novus-border pb-4 bg-white px-6 rounded-xl shadow-sm">
        <div>
            <img src="/logo.png" alt="Novus Logo" className="h-12 w-auto" />
            <p className="text-[10px] text-gray-400 font-mono mt-1">REAL DATA ENGINE | START CAP: $100,000</p>
        </div>
        <div className="flex items-center gap-6">
            {/* Smoothing Lambda Slider */}
            <div className="flex flex-col items-end gap-1 px-4 border-r border-novus-border">
                <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                    <Settings2 size={12} /> REBALANCE SPEED (λ)
                </div>
                <div className="flex items-center gap-3">
                    <input 
                        type="range" min="0.05" max="1.0" step="0.05" 
                        value={smoothing} 
                        onChange={(e) => setSmoothing(parseFloat(e.target.value))}
                        className="w-24 accent-black h-1 bg-gray-200 rounded-full appearance-none cursor-pointer"
                    />
                    <span className="text-black font-bold text-sm">{(smoothing).toFixed(2)}</span>
                </div>
            </div>
            {/* Volatility Target Slider */}
            <div className="flex flex-col items-end gap-1 px-4 border-r border-novus-border">
                <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                    <Settings2 size={12} /> MAX RISK TARGET (VOL)
                </div>
                <div className="flex items-center gap-3">
                    <input 
                        type="range" min="0.05" max="0.30" step="0.01" 
                        value={targetVol} 
                        onChange={(e) => setTargetVol(parseFloat(e.target.value))}
                        className="w-32 accent-black h-1 bg-gray-200 rounded-full appearance-none cursor-pointer"
                    />
                    <span className="text-black font-bold text-sm">{(targetVol * 100).toFixed(0)}%</span>
                </div>
            </div>
            <div className="text-right font-mono">
                <div className="text-xl text-black">{currentDate}</div>
                <div className={`text-sm font-bold ${statusColor}`}>{status}</div>
            </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        
        <div className="col-span-8 flex flex-col gap-4">
            <div className="glass-panel flex-1 relative min-h-[400px]">
                <SurfaceChart 
                    zData={data.surfaces[currentIndex]} 
                    xData={data.metadata.x_pdf}
                    yData={data.metadata.y_lags}
                    maxZ={100}
                />
            </div>
            
            <ControlBar 
                isPlaying={isPlaying} 
                onTogglePlay={() => setIsPlaying(!isPlaying)}
                speed={speed}
                setSpeed={setSpeed}
                progress={currentIndex}
                onSeek={(val) => { setCurrentIndex(val); setIsPlaying(false); }}
                max={data.returns.dates.length - 1}
            />
        </div>

        <div className="col-span-4 flex flex-col gap-4">
            
            <div className="glass-panel h-64 relative p-2">
                <PerformanceChart 
                    dates={data.returns.dates} 
                    buyHold={buyHoldIndex} 
                    novus={novusIndex} 
                    currentIndex={currentIndex}
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel p-4 flex flex-col justify-between">
                    <span className="text-xs text-gray-500 font-mono uppercase">Novus Algo Equity</span>
                    <span className={`text-2xl font-bold ${novusReturn >= 0 ? 'text-novus-green' : 'text-novus-red'}`}>
                        ${novVal.toLocaleString(undefined, {maximumFractionDigits:0})}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-1">{novusReturn > 0 ? '+' : ''}{novusReturn.toFixed(1)}%</span>
                </div>
                <div className="glass-panel p-4 flex flex-col justify-between">
                    <span className="text-xs text-gray-500 font-mono uppercase">Buy & Hold Equity</span>
                    <span className={`text-2xl font-bold ${bhReturn >= 0 ? 'text-gray-400' : 'text-novus-red'}`}>
                        ${bhVal.toLocaleString(undefined, {maximumFractionDigits:0})}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-1">{bhReturn > 0 ? '+' : ''}{bhReturn.toFixed(1)}%</span>
                </div>
                <div className="glass-panel p-4 flex flex-col justify-between col-span-2">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-gray-500 font-mono">LIVE EXPOSURE</span>
                        <span className="text-xl font-mono font-bold text-black">
                            {currentLev.toFixed(2)}x
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                        <div 
                            className={`h-full ${currentLev < 0.7 ? 'bg-novus-red' : 'bg-black'} transition-all duration-300`}
                            style={{ width: `${currentLev * 100}%` }}
                        />
                    </div>
                </div>

                <div className="glass-panel p-4 col-span-2">
                    <table className="w-full text-xs font-mono text-gray-600">
                        <thead>
                            <tr className="border-b border-gray-200">
                                <th className="text-left pb-2">METRIC</th>
                                <th className="text-right pb-2 text-black">NOVUS</th>
                                <th className="text-right pb-2 text-gray-400">B&H</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            <tr>
                                <td className="py-2 font-medium">CAGR</td>
                                <td className="text-right py-2 text-novus-green font-bold">{(novMetrics.ret * 100).toFixed(1)}%</td>
                                <td className="text-right py-2 text-gray-500">{(bhMetrics.ret * 100).toFixed(1)}%</td>
                            </tr>
                            <tr>
                                <td className="py-2 font-medium">VOLATILITY</td>
                                <td className="text-right py-2 text-black font-bold">{(novMetrics.vol * 100).toFixed(1)}%</td>
                                <td className="text-right py-2 text-gray-500">{(bhMetrics.vol * 100).toFixed(1)}%</td>
                            </tr>
                            <tr>
                                <td className="py-2 font-medium">SHARPE</td>
                                <td className="text-right py-2 text-novus-green font-bold">{novMetrics.sharpe.toFixed(2)}</td>
                                <td className="text-right py-2 text-gray-500">{bhMetrics.sharpe.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Allocation Table */}
            <div className="glass-panel flex-1 p-4 overflow-hidden flex flex-col">
                <h3 className="text-xs text-gray-500 font-mono mb-3">ASSET ALLOCATION</h3>
                <div className="space-y-2 font-mono text-sm text-gray-700">
                    {data.metadata.asset_names.map((asset) => {
                        const baseWeight = currentBaseWeights[asset] || 0;
                        const actualWeight = baseWeight * currentLev;
                        return (
                            <div key={asset} className="flex justify-between items-center">
                                <span className="text-gray-500">{asset}</span>
                                <div className="flex items-center gap-2">
                                    <div className="w-16 h-1 bg-gray-200 rounded">
                                        <div 
                                            className="h-full bg-black transition-all duration-300"
                                            style={{ width: `${actualWeight * 100}%` }}
                                        />
                                    </div>
                                    <span className="w-12 text-right">{(actualWeight * 100).toFixed(1)}%</span>
                                </div>
                            </div>
                        );
                    })}
                    <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200">
                        <span className={currentLev < 1 ? "text-novus-green font-bold" : "text-gray-400"}>CASH (LIQUIDITY)</span>
                        <div className="flex items-center gap-2">
                                <div className="w-16 h-1 bg-gray-200 rounded">
                                    <div 
                                        className="h-full bg-novus-green transition-all duration-300"
                                        style={{ width: `${Math.max(0, 1 - currentLev) * 100}%` }}
                                    />
                                </div>
                                <span className={`w-12 text-right ${currentLev < 1 ? "text-novus-green font-bold" : "text-gray-400"}`}>
                                    {(Math.max(0, 1 - currentLev) * 100).toFixed(1)}%
                                </span>
                        </div>
                    </div>
                </div>
            </div>

        </div>
      </div>
    </div>
  );
}

export default App;
